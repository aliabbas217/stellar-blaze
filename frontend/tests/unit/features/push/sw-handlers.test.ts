import ur from "../../../../messages/ur.json";
import { notificationContent } from "@/features/push/notification";
import type { PushPayload } from "@/features/push/payload";
import {
  openNotificationTarget,
  readPushData,
  showPushNotification,
  type ClientLike,
  type PushNotificationOptions,
} from "@/features/push/sw-handlers";

/*
 * The service worker's two listeners, driven with fakes. What matters: a valid push becomes exactly one notification
 * in the stored language that opens that language's worker route; an invalid one becomes none and never throws; a tap
 * focuses the window already on the page, else opens it.
 */

const red: PushPayload = {
  v: 1,
  audience: "site",
  target_id: "site-demo-mussafah",
  level: "red",
  template_id: "level-change",
  valid_from: "2026-11-11T09:00:00Z",
};

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

    expect(await showPushNotification(red, deps)).toBe(true);

    const content = notificationContent("ur", red);
    expect(show).toHaveBeenCalledTimes(1);
    expect(show).toHaveBeenCalledWith(content.title, {
      body: content.body,
      tag: "site:site-demo-mussafah",
      lang: "ur",
      vibrate: [400, 100, 400, 100, 400],
      renotify: true,
      icon: "/icons/icon-192.png",
      data: { url: "/ur/worker?from=push&level=red" },
    });
    expect(content.title).toBe(ur.push.title.site.replace("{level}", ur.push.level.red));
  });

  it("falls back to English when the stored locale is one the worker has no strings for", async () => {
    const { deps, show } = pushDeps("xx");
    await showPushNotification(red, deps);
    expect(show.mock.calls[0]?.[1].data).toEqual({ url: "/en/worker?from=push&level=red" });
  });

  it("falls back to English, and still shows, when the stored locale cannot be read", async () => {
    const { deps, show } = pushDeps(new Error("cache blocked"));
    expect(await showPushNotification(red, deps)).toBe(true);
    expect(show.mock.calls[0]?.[1].lang).toBe("en");
  });

  it.each([
    ["an extra key (a worker id)", { ...red, worker_id: "w-1" }],
    ["an unknown level", { ...red, level: "purple" }],
    ["a version it does not know", { ...red, v: 2 }],
    ["a body that was not JSON", undefined],
    ["a string", "Stay hydrated"],
  ])("shows nothing, and does not throw, for %s", async (_name, data) => {
    const { deps, show } = pushDeps();
    await expect(showPushNotification(data, deps)).resolves.toBe(false);
    expect(show).not.toHaveBeenCalled();
  });

  it("lets a failure of the notification itself surface (the spike reads it in the worker console)", async () => {
    const { deps, show } = pushDeps();
    show.mockRejectedValueOnce(new TypeError("No notification permission has been granted"));
    await expect(showPushNotification(red, deps)).rejects.toThrow("permission");
  });
});

describe("openNotificationTarget", () => {
  const ORIGIN = "https://app.example";

  function clickDeps(open: readonly { url: string; focus?: () => Promise<unknown> }[], locale = "en") {
    const focus = vi.fn(() => Promise.resolve());
    const windows: ClientLike[] = open.map((client) => ({ url: client.url, focus: client.focus ?? focus }));
    const openWindow = vi.fn<(url: string) => Promise<void>>(() => Promise.resolve());
    return { deps: { origin: ORIGIN, readLocale: () => Promise.resolve(locale), windows: () => Promise.resolve(windows), openWindow }, focus, openWindow };
  }

  const data = { url: "/ur/worker?from=push&level=red" };

  it("focuses the window that is already on the target page, and opens nothing", async () => {
    const { deps, focus, openWindow } = clickDeps([{ url: `${ORIGIN}/ur/worker?source=pwa` }]);

    await openNotificationTarget(data, deps);

    expect(focus).toHaveBeenCalledTimes(1);
    expect(openWindow).not.toHaveBeenCalled();
  });

  it("opens the target in a new window when no window is on it", async () => {
    const { deps, focus, openWindow } = clickDeps([{ url: `${ORIGIN}/ur/worker/alerts` }, { url: `${ORIGIN}/en/worker` }]);

    await openNotificationTarget(data, deps);

    expect(openWindow).toHaveBeenCalledWith("/ur/worker?from=push&level=red");
    expect(focus).not.toHaveBeenCalled();
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
});
