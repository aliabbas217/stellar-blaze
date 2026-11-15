import ur from "../../../../messages/ur.json";
import { fallbackNotificationContent, notificationContent } from "@/features/push/notification";
import type { PushPayload } from "@/features/push/payload";
import {
  openNotificationTarget,
  readPushData,
  showPushNotification,
  type ClientLike,
  type PushNotificationOptions,
} from "@/features/push/sw-handlers";

/*
 * The service worker's two listeners, driven with fakes. What matters: every push becomes exactly one notification (a
 * push that shows none gets an installed iPhone app's subscription revoked); a valid one is built from the payload in the
 * stored language and opens that language's worker route; an unreadable one becomes the neutral notification, claims no
 * level and never throws; a tap focuses the window already on the page, else opens it.
 */

const red: PushPayload = {
  v: 1,
  audience: "site",
  target_id: "site-demo-mussafah",
  level: "red",
  template_id: "level-change",
  valid_from: "2026-11-11T09:00:00Z",
};

/** What a browser throws when a window can no longer be focused. */
class InvalidStateError extends Error {
  constructor() {
    super("The client is gone");
    this.name = "InvalidStateError";
  }
}

function pushDeps(locale: string | Error = "en") {
  const show = vi.fn<(title: string, options: PushNotificationOptions) => Promise<void>>(() => Promise.resolve());
  const readLocale = () => (locale instanceof Error ? Promise.reject(locale) : Promise.resolve(locale));
  return { deps: { readLocale, show }, show };
}

describe("readPushData", () => {
  it("returns the parsed body", () => {
    expect(readPushData({ data: { json: () => red } })).toEqual(red);
  });

  it("returns undefined when the push has no body", () => {
    expect(readPushData({ data: null })).toBeUndefined();
  });

  it("returns undefined, without throwing, when the body is not JSON", () => {
    expect(
      readPushData({
        data: {
          json: () => {
            throw new SyntaxError("Unexpected token");
          },
        },
      }),
    ).toBeUndefined();
  });
});

describe("showPushNotification", () => {
  it("shows one notification built from the payload and the stored locale", async () => {
    const { deps, show } = pushDeps("ur");

    expect(await showPushNotification(red, deps)).toBe("payload");

    const content = notificationContent("ur", red);
    expect(show).toHaveBeenCalledTimes(1);
    expect(show).toHaveBeenCalledWith(content.title, {
      body: content.body,
      tag: "site:site-demo-mussafah",
      lang: "ur",
      vibrate: [400, 100, 400, 100, 400],
      renotify: true,
      icon: "/icons/icon-192.png",
      data: { url: "/ur/worker/alert?audience=site&target=site-demo-mussafah&level=red&valid_from=2026-11-11T09%3A00%3A00Z" },
    });
    expect(content.title).toBe(ur.push.title.site.replace("{level}", ur.push.level.red));
  });

  it("falls back to English when the stored locale is one the worker has no strings for", async () => {
    const { deps, show } = pushDeps("xx");
    await showPushNotification(red, deps);
    expect(show.mock.calls[0]?.[1].data).toEqual({
      url: "/en/worker/alert?audience=site&target=site-demo-mussafah&level=red&valid_from=2026-11-11T09%3A00%3A00Z",
    });
  });

  it("falls back to English, and still shows, when the stored locale cannot be read", async () => {
    const { deps, show } = pushDeps(new Error("cache blocked"));
    expect(await showPushNotification(red, deps)).toBe("payload");
    expect(show.mock.calls[0]?.[1].lang).toBe("en");
  });

  describe("a push the worker cannot read", () => {
    it.each([
      ["an extra key (a worker id)", { ...red, worker_id: "w-1" }],
      ["an unknown level", { ...red, level: "purple" }],
      ["a version it does not know", { ...red, v: 2 }],
      ["a body that was not JSON, or no body", undefined],
      ["a string", "Stay hydrated"],
      ["null", null],
      ["an empty object", {}],
    ])("shows the neutral notification, once, and does not throw, for %s", async (_name, data) => {
      const { deps, show } = pushDeps("ur");

      await expect(showPushNotification(data, deps)).resolves.toBe("fallback");

      const neutral = fallbackNotificationContent("ur");
      expect(show).toHaveBeenCalledTimes(1);
      expect(show).toHaveBeenCalledWith(neutral.title, {
        body: neutral.body,
        tag: "fallback",
        lang: "ur",
        vibrate: [100],
        renotify: true,
        icon: "/icons/icon-192.png",
        data: { url: "/ur/worker?from=push" },
      });
    });

    it("is the app's name and the generic line in the stored language, claiming no level", async () => {
      const { deps, show } = pushDeps("ur");
      await showPushNotification({ ...red, worker_id: "w-1" }, deps);

      const [title, options] = show.mock.calls[0] ?? ["", {}];
      expect(title).toBe(ur.common.appName);
      expect(options.body).toBe(ur.push.body);
      const shownText = `${title} ${options.body ?? ""}`;
      expect(Object.values(ur.push.level).some((word) => shownText.includes(word))).toBe(false);
    });

    it("never shows text the payload supplied", async () => {
      const { deps, show } = pushDeps("en");
      await showPushNotification({ ...red, worker_id: "w-1", text: "Evacuate now", target_id: "site-secret" }, deps);
      expect(JSON.stringify(show.mock.calls)).not.toMatch(/w-1|Evacuate|secret/);
    });

    it("still shows when the stored locale cannot be read", async () => {
      const { deps, show } = pushDeps(new Error("cache blocked"));
      expect(await showPushNotification(undefined, deps)).toBe("fallback");
      expect(show.mock.calls[0]?.[1].lang).toBe("en");
    });

    it("has a tag that is never empty (renotify needs one) and cannot equal a level notification's", () => {
      const neutral = fallbackNotificationContent("en");
      expect(neutral.tag).not.toBe("");
      expect(neutral.tag).not.toContain(":");
      expect(neutral.renotify).toBe(true);
    });
  });

  it("lets a failure of the notification itself surface (the spike reads it in the worker console)", async () => {
    const { deps, show } = pushDeps();
    show.mockRejectedValueOnce(new TypeError("No notification permission has been granted"));
    await expect(showPushNotification(red, deps)).rejects.toThrow("permission");
  });
});

describe("openNotificationTarget", () => {
  const ORIGIN = "https://app.example";

  interface FakeClient {
    url: string;
    focus?: () => Promise<unknown>;
    navigate?: () => Promise<unknown>;
  }

  function clickDeps(open: readonly FakeClient[], locale = "en") {
    const focus = vi.fn(() => Promise.resolve());
    const navigate = vi.fn<(url: string) => Promise<unknown>>(() => Promise.resolve());
    const windows: ClientLike[] = open.map((client) => ({
      url: client.url,
      focus: client.focus ?? focus,
      navigate: client.navigate ?? navigate,
    }));
    const openWindow = vi.fn<(url: string) => Promise<void>>(() => Promise.resolve());
    return {
      deps: { origin: ORIGIN, readLocale: () => Promise.resolve(locale), windows: () => Promise.resolve(windows), openWindow },
      focus,
      navigate,
      openWindow,
    };
  }

  const data = { url: "/ur/worker?from=push&level=red" };

  it("focuses the window that is already on the target page, gives it the target's query, and opens nothing", async () => {
    const { deps, focus, navigate, openWindow } = clickDeps([{ url: `${ORIGIN}/ur/worker?source=pwa` }]);

    await openNotificationTarget(data, deps);

    expect(focus).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/ur/worker?from=push&level=red");
    expect(openWindow).not.toHaveBeenCalled();
  });

  it("does not reload a window that already shows the target url", async () => {
    const { deps, focus, navigate } = clickDeps([{ url: `${ORIGIN}/ur/worker?from=push&level=red` }]);

    await openNotificationTarget(data, deps);

    expect(focus).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("leaves a window it cannot navigate (not controlled by the worker) in front, without failing", async () => {
    const { deps, focus, openWindow } = clickDeps([
      { url: `${ORIGIN}/ur/worker`, navigate: () => Promise.reject(new TypeError("Cannot navigate an uncontrolled client")) },
    ]);

    await expect(openNotificationTarget(data, deps)).resolves.toBeUndefined();

    expect(focus).toHaveBeenCalledTimes(1);
    expect(openWindow).not.toHaveBeenCalled();
  });

  it("opens the target in a new window when focusing the existing one is refused", async () => {
    const { deps, navigate, openWindow } = clickDeps([
      { url: `${ORIGIN}/ur/worker`, focus: () => Promise.reject(new InvalidStateError()) },
    ]);

    await openNotificationTarget(data, deps);

    expect(openWindow).toHaveBeenCalledWith("/ur/worker?from=push&level=red");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("opens the target in a new window when no window is on it", async () => {
    const { deps, focus, navigate, openWindow } = clickDeps([{ url: `${ORIGIN}/ur/worker/alerts` }, { url: `${ORIGIN}/en/worker` }]);

    await openNotificationTarget(data, deps);

    expect(openWindow).toHaveBeenCalledWith("/ur/worker?from=push&level=red");
    expect(focus).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("opens the target when the app has no window at all", async () => {
    const { deps, openWindow } = clickDeps([]);
    await openNotificationTarget(data, deps);
    expect(openWindow).toHaveBeenCalledWith("/ur/worker?from=push&level=red");
  });

  it("does not take a window of another origin for the app's", async () => {
    const { deps, focus, openWindow } = clickDeps([{ url: "https://other.example/ur/worker" }]);
    await openNotificationTarget(data, deps);
    expect(focus).not.toHaveBeenCalled();
    expect(openWindow).toHaveBeenCalledTimes(1);
  });

  it("goes to the worker route of the stored locale when the notification carries no usable url", async () => {
    const { deps, openWindow } = clickDeps([], "ar");
    await openNotificationTarget({ url: "https://evil.example/" }, deps);
    expect(openWindow).toHaveBeenCalledWith("/ar/worker");
  });

  it("opens the neutral notification's target, which has no level", async () => {
    const { deps, openWindow } = clickDeps([]);
    await openNotificationTarget({ url: "/ur/worker?from=push" }, deps);
    expect(openWindow).toHaveBeenCalledWith("/ur/worker?from=push");
  });
});
