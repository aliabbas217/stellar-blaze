import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw/http";
import { useProfile } from "@/features/profile/store";
import type { SubscriptionLike } from "@/features/push/subscribe";
import { REGISTRATION_TIMEOUT_MS, usePush, type PushConfig, type PushPlatform } from "@/features/push/usePush";
import { problemOnce } from "@/mocks/handlers";
import { server } from "@/mocks/node";

/*
 * The Alerts screen's state machine against a fake browser and the mock API (MSW). What it must guarantee, from the
 * plan's review focus 4: Enable never throws, a refusal and a failure each end in a state the screen can explain, and
 * the API's registration id is remembered on the device and re-made when the browser's subscription changed.
 */

const ENDPOINT = "https://push.example/send/abc123";
const CONFIG: PushConfig = { vapidPublicKey: Buffer.from(new Uint8Array(65).fill(4)).toString("base64url"), siteId: "site-demo-mussafah" };

function browserSubscription(endpoint = ENDPOINT, unsubscribe = vi.fn(() => Promise.resolve(true))): SubscriptionLike {
  return {
    endpoint,
    toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh: "p256dh-value", auth: "auth-value" } }),
    unsubscribe,
  };
}

interface FakeOptions {
  capability?: ReturnType<PushPlatform["capability"]>;
  permission?: NotificationPermission;
  /** What the permission prompt answers. */
  answer?: NotificationPermission;
  existing?: SubscriptionLike | null;
}

function fakePlatform(options: FakeOptions = {}) {
  const calls: string[] = [];
  const created = browserSubscription();
  const subscribe = vi.fn(async () => {
    calls.push("subscribe");
    await Promise.resolve();
    return created;
  });
  const getSubscription = vi.fn(() => Promise.resolve(options.existing ?? null));
  const registration = vi.fn(() => {
    calls.push("registration");
    return Promise.resolve({ pushManager: { subscribe, getSubscription } });
  });
  const requestPermission = vi.fn(() => {
    calls.push("requestPermission");
    return Promise.resolve(options.answer ?? "granted");
  });
  const platform: PushPlatform = {
    capability: () => options.capability ?? "supported",
    permission: () => options.permission ?? "default",
    watchPermission: () => () => undefined,
    requestPermission,
    registration,
  };
  return { platform, calls, subscribe, getSubscription, registration, requestPermission };
}

/** Counts and records what the API receives for the two push calls. */
function spyOnApi() {
  const posts: unknown[] = [];
  const deletes: string[] = [];
  server.use(
    http.post("*/api/v1/push/subscriptions", async ({ request }) => {
      posts.push(await request.json());
      return HttpResponse.json({ id: `sub-${String(posts.length)}` }, { status: 201 });
    }),
    http.delete("*/api/v1/push/subscriptions/:id", ({ params }) => {
      deletes.push(String(params["id"]));
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return { posts, deletes };
}

beforeEach(() => {
  localStorage.clear();
  useProfile.setState({ push: null });
});

describe("usePush: enable", () => {
  it("asks for permission first, then subscribes, registers and remembers the registration", async () => {
    const { platform, calls } = fakePlatform();
    const { posts } = spyOnApi();
    const { result } = renderHook(() => usePush(CONFIG, platform));
    expect(result.current.state).toBe("idle");

    await act(async () => {
      await result.current.enable();
    });

    expect(calls).toEqual(["requestPermission", "registration", "subscribe"]);
    expect(result.current.state).toBe("subscribed");
    expect(result.current.subscription?.endpoint).toBe(ENDPOINT);
    expect(posts).toEqual([
      {
        subscription: { endpoint: ENDPOINT, expirationTime: null, keys: { p256dh: "p256dh-value", auth: "auth-value" } },
        site_id: "site-demo-mussafah",
        crew_id: null,
      },
    ]);
    expect(useProfile.getState().push).toEqual({ serverId: "sub-1", endpoint: ENDPOINT, siteId: "site-demo-mussafah" });
  });

  it("is requesting while the permission prompt is open, and subscribed after the worker allows it", async () => {
    const { platform } = fakePlatform();
    spyOnApi();
    let answer: (permission: NotificationPermission) => void = () => undefined;
    const prompt = new Promise<NotificationPermission>((resolve) => {
      answer = resolve;
    });
    const { result } = renderHook(() => usePush(CONFIG, { ...platform, requestPermission: () => prompt }));

    let running = Promise.resolve();
    act(() => {
      running = result.current.enable();
    });
    expect(result.current.state).toBe("requesting");

    await act(async () => {
      answer("granted");
      await running;
    });
    expect(result.current.state).toBe("subscribed");
  });

  it("ends in denied, and subscribes nothing, when the worker blocks the prompt", async () => {
    const { platform, subscribe } = fakePlatform({ answer: "denied" });
    const { result } = renderHook(() => usePush(CONFIG, platform));

    await act(async () => {
      await result.current.enable();
    });

    expect(result.current.state).toBe("denied");
    expect(subscribe).not.toHaveBeenCalled();
    expect(useProfile.getState().push).toBeNull();
  });

  it("goes back to idle when the prompt is dismissed without an answer", async () => {
    const { platform, subscribe } = fakePlatform({ answer: "default" });
    const { result } = renderHook(() => usePush(CONFIG, platform));

    await act(async () => {
      await result.current.enable();
    });

    expect(result.current.state).toBe("idle");
    expect(subscribe).not.toHaveBeenCalled();
  });

  it("ends in error, keeps the browser's subscription and the request id, when the server refuses", async () => {
    const { platform } = fakePlatform();
    server.use(problemOnce("/api/v1/push/subscriptions", 502));
    const { result } = renderHook(() => usePush(CONFIG, platform));

    await act(async () => {
      await result.current.enable();
    });

    expect(result.current.state).toBe("error");
    expect(result.current.failure).toBe("enable");
    expect(result.current.problem).toMatchObject({ status: 502, request_id: "mock-req-1" });
    expect(result.current.subscription?.endpoint).toBe(ENDPOINT);
    expect(useProfile.getState().push).toBeNull();
  });

  it("recovers on the next tap after a failure", async () => {
    const { platform } = fakePlatform();
    server.use(problemOnce("/api/v1/push/subscriptions", 502));
    const { result } = renderHook(() => usePush(CONFIG, platform));

    await act(async () => {
      await result.current.enable();
    });
    await act(async () => {
      await result.current.enable();
    });

    expect(result.current.state).toBe("subscribed");
    expect(result.current.problem).toBeNull();
    expect(result.current.failure).toBeNull();
  });

  it("does not throw when the browser refuses to subscribe: the state is error", async () => {
    const { platform, subscribe } = fakePlatform();
    subscribe.mockRejectedValueOnce(new DOMException("push service error", "AbortError"));
    const { result } = renderHook(() => usePush(CONFIG, platform));

    await act(async () => {
      await expect(result.current.enable()).resolves.toBeUndefined();
    });

    expect(result.current.state).toBe("error");
    expect(result.current.failure).toBe("enable");
  });

  it("does not throw when the service worker fails to become ready: the state is error", async () => {
    const { platform, registration } = fakePlatform();
    registration.mockRejectedValueOnce(new Error("no service worker"));
    const { result } = renderHook(() => usePush(CONFIG, platform));

    await act(async () => {
      await expect(result.current.enable()).resolves.toBeUndefined();
    });

    expect(result.current.state).toBe("error");
  });

  it("does not hang when the service worker never becomes ready: after 10 s the state is error, and the next tap works", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { platform, registration } = fakePlatform();
    // navigator.serviceWorker.ready never settles when no worker registers.
    registration.mockImplementationOnce(() => new Promise<never>(() => undefined));
    const { result } = renderHook(() => usePush(CONFIG, platform));

    let running = Promise.resolve();
    act(() => {
      running = result.current.enable();
    });
    expect(result.current.state).toBe("requesting");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(REGISTRATION_TIMEOUT_MS);
      await running;
    });
    expect(result.current.state).toBe("error");
    expect(result.current.failure).toBe("enable");

    // The tap that waited released its lock: the button is usable again and the next tap goes through.
    vi.useRealTimers();
    spyOnApi();
    await act(async () => {
      await result.current.enable();
    });
    expect(result.current.state).toBe("subscribed");
  });

  it.each([
    ["a VAPID key", { ...CONFIG, vapidPublicKey: null }],
    ["a site", { ...CONFIG, siteId: null }],
  ])("ends in error, without asking permission, when there is no %s", async (_name, config) => {
    const { platform, requestPermission } = fakePlatform();
    const { result } = renderHook(() => usePush(config, platform));

    await act(async () => {
      await result.current.enable();
    });

    expect(result.current.state).toBe("error");
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("a second tap while the first is running subscribes once", async () => {
    const { platform, subscribe } = fakePlatform();
    spyOnApi();
    const { result } = renderHook(() => usePush(CONFIG, platform));

    await act(async () => {
      await Promise.all([result.current.enable(), result.current.enable()]);
    });

    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(result.current.state).toBe("subscribed");
  });
});

describe("usePush: app open", () => {
  it("shows denied at once when the worker blocked notifications earlier", async () => {
    const { platform } = fakePlatform({ permission: "denied" });
    const { result } = renderHook(() => usePush(CONFIG, platform));
    await waitFor(() => {
      expect(result.current.state).toBe("denied");
    });
  });

  it("touches nothing on a browser that cannot do push", async () => {
    const { platform, registration } = fakePlatform({ capability: "unsupported", permission: "granted" });
    const { result } = renderHook(() => usePush(CONFIG, platform));
    await Promise.resolve();
    expect(result.current.state).toBe("idle");
    expect(registration).not.toHaveBeenCalled();
  });

  it("stays idle, and asks nothing, when permission was never given", async () => {
    const { platform, registration } = fakePlatform({ permission: "default" });
    renderHook(() => usePush(CONFIG, platform));
    await Promise.resolve();
    expect(registration).not.toHaveBeenCalled();
  });

  it("is subscribed, with no request to the API, when the browser's subscription is the one stored", async () => {
    useProfile.getState().setPush({ serverId: "sub-9", endpoint: ENDPOINT, siteId: CONFIG.siteId ?? "" });
    const { platform } = fakePlatform({ permission: "granted", existing: browserSubscription() });
    const { posts } = spyOnApi();

    const { result } = renderHook(() => usePush(CONFIG, platform));

    await waitFor(() => {
      expect(result.current.state).toBe("subscribed");
    });
    expect(result.current.subscription?.endpoint).toBe(ENDPOINT);
    expect(posts).toHaveLength(0);
  });

  it("registers again when the browser's endpoint differs from the stored one", async () => {
    useProfile.getState().setPush({ serverId: "sub-old", endpoint: "https://push.example/send/OLD", siteId: CONFIG.siteId ?? "" });
    const { platform } = fakePlatform({ permission: "granted", existing: browserSubscription() });
    const { posts, deletes } = spyOnApi();

    const { result } = renderHook(() => usePush(CONFIG, platform));

    await waitFor(() => {
      expect(result.current.state).toBe("subscribed");
    });
    expect(posts).toHaveLength(1);
    expect(useProfile.getState().push).toEqual({ serverId: "sub-1", endpoint: ENDPOINT, siteId: "site-demo-mussafah" });
    // The registration of the endpoint this phone no longer uses is deleted, once the new one is in.
    await waitFor(() => {
      expect(deletes).toEqual(["sub-old"]);
    });
  });

  it("does not delete the stored registration when the API answers the new one with the same id", async () => {
    useProfile.getState().setPush({ serverId: "sub-old", endpoint: "https://push.example/send/OLD", siteId: CONFIG.siteId ?? "" });
    const { platform } = fakePlatform({ permission: "granted", existing: browserSubscription() });
    const { deletes } = spyOnApi();
    // An API that treats the endpoint as the key (contract section 5) hands back the id it already has.
    server.use(http.post("*/api/v1/push/subscriptions", () => HttpResponse.json({ id: "sub-old" }, { status: 201 })));

    const { result } = renderHook(() => usePush(CONFIG, platform));

    await waitFor(() => {
      expect(result.current.state).toBe("subscribed");
    });
    expect(useProfile.getState().push?.serverId).toBe("sub-old");
    expect(deletes).toEqual([]);
  });

  it("deletes the registration of the previous site when the worker turns alerts on for another", async () => {
    useProfile.getState().setPush({ serverId: "sub-other-site", endpoint: "https://push.example/send/OLD", siteId: "site-other" });
    const { platform } = fakePlatform();
    const { deletes } = spyOnApi();
    const { result } = renderHook(() => usePush(CONFIG, platform));

    await act(async () => {
      await result.current.enable();
    });

    expect(useProfile.getState().push).toEqual({ serverId: "sub-1", endpoint: ENDPOINT, siteId: "site-demo-mussafah" });
    expect(deletes).toEqual(["sub-other-site"]);
  });

  it("is still subscribed when deleting the previous registration fails", async () => {
    useProfile.getState().setPush({ serverId: "sub-old", endpoint: "https://push.example/send/OLD", siteId: CONFIG.siteId ?? "" });
    const { platform } = fakePlatform({ permission: "granted", existing: browserSubscription() });
    spyOnApi();
    server.use(problemOnce("/api/v1/push/subscriptions/:subscription_id", 502));

    const { result } = renderHook(() => usePush(CONFIG, platform));

    await waitFor(() => {
      expect(result.current.state).toBe("subscribed");
    });
    expect(useProfile.getState().push?.serverId).toBe("sub-1");
  });

  it("registers a subscription the API was never told about (nothing stored)", async () => {
    const { platform } = fakePlatform({ permission: "granted", existing: browserSubscription() });
    const { posts } = spyOnApi();

    const { result } = renderHook(() => usePush(CONFIG, platform));

    await waitFor(() => {
      expect(result.current.state).toBe("subscribed");
    });
    expect(posts).toHaveLength(1);
  });

  it("reports an error, keeping the subscription, when registering again fails", async () => {
    server.use(problemOnce("/api/v1/push/subscriptions", 502));
    const { platform } = fakePlatform({ permission: "granted", existing: browserSubscription() });

    const { result } = renderHook(() => usePush(CONFIG, platform));

    await waitFor(() => {
      expect(result.current.state).toBe("error");
    });
    expect(result.current.problem?.status).toBe(502);
    expect(result.current.subscription?.endpoint).toBe(ENDPOINT);
  });

  it("deletes the stored registration, then forgets it, when the browser no longer has a subscription", async () => {
    useProfile.getState().setPush({ serverId: "sub-old", endpoint: ENDPOINT, siteId: CONFIG.siteId ?? "" });
    const { platform, getSubscription } = fakePlatform({ permission: "granted", existing: null });
    const { deletes } = spyOnApi();

    const { result } = renderHook(() => usePush(CONFIG, platform));

    await waitFor(() => {
      expect(useProfile.getState().push).toBeNull();
    });
    expect(getSubscription).toHaveBeenCalled();
    expect(deletes).toEqual(["sub-old"]);
    expect(result.current.state).toBe("idle");
  });

  it("keeps the stored registration, to try again on the next app open, when the delete cannot be made", async () => {
    useProfile.getState().setPush({ serverId: "sub-old", endpoint: ENDPOINT, siteId: CONFIG.siteId ?? "" });
    const failed = vi.fn();
    server.use(
      http.delete("*/api/v1/push/subscriptions/:id", () => {
        failed();
        return HttpResponse.json({ type: "about:blank", title: "Bad Gateway", status: 502 }, { status: 502 });
      }),
    );
    const { platform } = fakePlatform({ permission: "granted", existing: null });

    renderHook(() => usePush(CONFIG, platform));

    await waitFor(() => {
      expect(failed).toHaveBeenCalledTimes(1);
    });
    // Give the failed delete time to settle: nothing may clear the id.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(useProfile.getState().push?.serverId).toBe("sub-old");
  });

  it("forgets the stored registration when the API does not know it (a 404 means it is gone)", async () => {
    useProfile.getState().setPush({ serverId: "sub-gone", endpoint: ENDPOINT, siteId: CONFIG.siteId ?? "" });
    server.use(problemOnce("/api/v1/push/subscriptions/:subscription_id", 404));
    const { platform } = fakePlatform({ permission: "granted", existing: null });

    renderHook(() => usePush(CONFIG, platform));

    await waitFor(() => {
      expect(useProfile.getState().push).toBeNull();
    });
  });

  it("does not register a stored subscription for another site as the current one", async () => {
    useProfile.getState().setPush({ serverId: "sub-9", endpoint: ENDPOINT, siteId: "site-other" });
    const { platform } = fakePlatform({ permission: "granted", existing: browserSubscription() });
    const { posts } = spyOnApi();

    renderHook(() => usePush(CONFIG, platform));

    await waitFor(() => {
      expect(posts).toHaveLength(1);
    });
    expect(useProfile.getState().push?.siteId).toBe("site-demo-mussafah");
  });
});

describe("usePush: disable", () => {
  async function subscribed() {
    const unsubscribe = vi.fn(() => Promise.resolve(true));
    const fake = fakePlatform({ existing: browserSubscription(ENDPOINT, unsubscribe) });
    const api = spyOnApi();
    const hook = renderHook(() => usePush(CONFIG, fake.platform));
    await act(async () => {
      await hook.result.current.enable();
    });
    return { ...fake, ...api, ...hook, unsubscribe };
  }

  it("does not hang when the service worker never becomes ready: after 10 s Turn off ends in error, keeping the registration", async () => {
    const { result, registration } = await subscribed();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    registration.mockImplementationOnce(() => new Promise<never>(() => undefined));

    let running = Promise.resolve();
    act(() => {
      running = result.current.disable();
    });
    expect(result.current.state).toBe("requesting");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REGISTRATION_TIMEOUT_MS);
      await running;
    });
    vi.useRealTimers();

    expect(result.current.state).toBe("error");
    expect(result.current.failure).toBe("disable");
    expect(useProfile.getState().push?.serverId).toBe("sub-1");
  });

  it("unsubscribes in the browser, deletes the registration, forgets it and goes idle", async () => {
    const { result, unsubscribe, deletes } = await subscribed();
    expect(useProfile.getState().push?.serverId).toBe("sub-1");

    await act(async () => {
      await result.current.disable();
    });

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(deletes).toEqual(["sub-1"]);
    expect(useProfile.getState().push).toBeNull();
    expect(result.current.state).toBe("idle");
    expect(result.current.subscription).toBeNull();
  });

  it("reports the failure as a turn-off failure, and keeps the registration so the next tap retries", async () => {
    const { result, deletes } = await subscribed();
    server.use(problemOnce("/api/v1/push/subscriptions/:subscription_id", 502));

    await act(async () => {
      await result.current.disable();
    });

    expect(result.current.state).toBe("error");
    expect(result.current.failure).toBe("disable");
    expect(result.current.problem?.request_id).toBe("mock-req-1");
    expect(useProfile.getState().push?.serverId).toBe("sub-1");

    await act(async () => {
      await result.current.disable();
    });

    expect(deletes).toEqual(["sub-1"]);
    expect(result.current.state).toBe("idle");
    expect(useProfile.getState().push).toBeNull();
  });
});
