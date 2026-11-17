import type { Mock } from "vitest";
import { ApiProblem, type Problem } from "@/api/problem";
import type { Result } from "@/api/result";
import {
  subscribeToSiteAlerts,
  unsubscribe,
  urlBase64ToUint8Array,
  type PushSubscriptionBody,
  type RegistrationLike,
  type SubscriptionLike,
} from "@/features/push/subscribe";

/*
 * The subscription flow with a fake PushManager (jsdom has none). The contract points that matter:
 *  - the browser is asked with userVisibleOnly and the decoded VAPID key (a string key is not accepted everywhere);
 *  - the local subscription is returned even when the server says no (the real-phone spike relies on it);
 *  - a double tap on Enable is one subscribe call, not two;
 *  - the body sent to the API is exactly the contract's shape: the subscription, the site, the crew, nothing else.
 */

// 65 bytes, like an uncompressed P-256 point: 0x04 then 64 bytes. The fake manager never validates it.
const keyBytes = Uint8Array.from([4, ...Array.from({ length: 64 }, (_, index) => index)]);
const VAPID_KEY = Buffer.from(keyBytes).toString("base64url");

const ENDPOINT = "https://push.example/send/abc123";
const JSON_FROM_BROWSER: PushSubscriptionJSON = {
  endpoint: ENDPOINT,
  expirationTime: null,
  keys: { p256dh: "p256dh-value", auth: "auth-value" },
};

interface FakeSubscription extends SubscriptionLike {
  toJSON: () => PushSubscriptionJSON;
  unsubscribe: Mock<() => Promise<boolean>>;
}

function fakeSubscription(unsubscribe: Mock<() => Promise<boolean>> = vi.fn(() => Promise.resolve(true))): FakeSubscription {
  return { endpoint: ENDPOINT, toJSON: () => JSON_FROM_BROWSER, unsubscribe };
}

/** A manager whose subscribe resolves after a microtask, as a real one resolves after the permission and the network. */
function fakeRegistration(existing: SubscriptionLike | null = null) {
  const subscription = fakeSubscription();
  const subscribe = vi.fn<(options: PushSubscriptionOptionsInit) => Promise<SubscriptionLike>>(async () => {
    await Promise.resolve();
    return subscription;
  });
  const getSubscription = vi.fn(() => Promise.resolve(existing));
  const registration: RegistrationLike = { pushManager: { subscribe, getSubscription } };
  return { registration, subscribe, getSubscription, subscription };
}

const created: Result<{ id: string }> = { ok: true, data: { id: "sub-1" } };
const badGateway: Problem = { type: "about:blank", title: "Bad Gateway", status: 502, request_id: "req-9" };

describe("urlBase64ToUint8Array", () => {
  it("decodes base64url with and without padding", () => {
    expect(urlBase64ToUint8Array(VAPID_KEY)).toEqual(keyBytes);
    expect(urlBase64ToUint8Array(`${VAPID_KEY}==`)).toEqual(keyBytes);
  });

  it("decodes the url-safe characters - and _", () => {
    expect(urlBase64ToUint8Array("-_8")).toEqual(Uint8Array.from([251, 255]));
  });
});

describe("subscribeToSiteAlerts", () => {
  it("asks the browser with userVisibleOnly and the decoded key", async () => {
    const { registration, subscribe } = fakeRegistration();
    await subscribeToSiteAlerts({
      registration,
      vapidPublicKey: VAPID_KEY,
      siteId: "site-demo-mussafah",
      crewId: null,
      post: () => Promise.resolve(created),
    });

    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: keyBytes });
  });

  it("posts exactly the contract body and returns the server id with the local subscription", async () => {
    const { registration } = fakeRegistration();
    const post = vi.fn<(body: PushSubscriptionBody) => Promise<Result<{ id: string }>>>(() => Promise.resolve(created));

    const outcome = await subscribeToSiteAlerts({
      registration,
      vapidPublicKey: VAPID_KEY,
      siteId: "site-demo-mussafah",
      crewId: "crew-a",
      post,
    });

    expect(post).toHaveBeenCalledWith({
      subscription: { endpoint: ENDPOINT, expirationTime: null, keys: { p256dh: "p256dh-value", auth: "auth-value" } },
      site_id: "site-demo-mussafah",
      crew_id: "crew-a",
    });
    expect(outcome).toEqual({ subscription: JSON_FROM_BROWSER, serverId: "sub-1", problem: null });
  });

  it("sends expirationTime null when the browser leaves it out, and never extra members", async () => {
    const { registration, subscription } = fakeRegistration();
    subscription.toJSON = () => ({ endpoint: ENDPOINT, keys: { p256dh: "p", auth: "a", extra: "ignored" } });
    const post = vi.fn<(body: PushSubscriptionBody) => Promise<Result<{ id: string }>>>(() => Promise.resolve(created));

    await subscribeToSiteAlerts({ registration, vapidPublicKey: VAPID_KEY, siteId: "s", crewId: null, post });

    expect(post.mock.calls[0]?.[0]).toEqual({
      subscription: { endpoint: ENDPOINT, expirationTime: null, keys: { p256dh: "p", auth: "a" } },
      site_id: "s",
      crew_id: null,
    });
  });

  it("still returns the local subscription when the server registration fails", async () => {
    const { registration } = fakeRegistration();

    const outcome = await subscribeToSiteAlerts({
      registration,
      vapidPublicKey: VAPID_KEY,
      siteId: "site-demo-mussafah",
      crewId: null,
      post: () => Promise.resolve({ ok: false, problem: badGateway }),
    });

    expect(outcome.subscription.endpoint).toBe(ENDPOINT);
    expect(outcome.problem?.status).toBe(502);
    expect(outcome.problem?.request_id).toBe("req-9");
    expect(outcome.serverId).toBeNull();
  });

  it("makes one pushManager.subscribe call for two concurrent calls (the in-flight promise is reused)", async () => {
    const { registration, subscribe } = fakeRegistration();
    const post = vi.fn<(body: PushSubscriptionBody) => Promise<Result<{ id: string }>>>(() => Promise.resolve(created));
    const deps = { registration, vapidPublicKey: VAPID_KEY, siteId: "site-demo-mussafah", crewId: null, post };

    const [first, second] = await Promise.all([subscribeToSiteAlerts(deps), subscribeToSiteAlerts(deps)]);

    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it("does not reuse a settled call: the next tap subscribes again", async () => {
    const { registration, subscribe } = fakeRegistration();
    const deps = { registration, vapidPublicKey: VAPID_KEY, siteId: "s", crewId: null, post: () => Promise.resolve(created) };

    await subscribeToSiteAlerts(deps);
    await subscribeToSiteAlerts(deps);

    expect(subscribe).toHaveBeenCalledTimes(2);
  });

  it("does not reuse a call for another site", async () => {
    const { registration, subscribe } = fakeRegistration();
    const base = { registration, vapidPublicKey: VAPID_KEY, crewId: null, post: () => Promise.resolve(created) };

    await Promise.all([subscribeToSiteAlerts({ ...base, siteId: "site-a" }), subscribeToSiteAlerts({ ...base, siteId: "site-b" })]);

    expect(subscribe).toHaveBeenCalledTimes(2);
  });

  it("clears the in-flight entry when the browser refuses, so the next tap can try again", async () => {
    const { registration, subscribe } = fakeRegistration();
    subscribe.mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"));
    const deps = { registration, vapidPublicKey: VAPID_KEY, siteId: "s", crewId: null, post: () => Promise.resolve(created) };

    await expect(subscribeToSiteAlerts(deps)).rejects.toMatchObject({ name: "NotAllowedError" });
    await expect(subscribeToSiteAlerts(deps)).resolves.toMatchObject({ serverId: "sub-1" });
  });

  it("rejects, and posts nothing, when the browser's subscription lacks keys (nothing to register)", async () => {
    const { registration, subscription } = fakeRegistration();
    subscription.toJSON = () => ({ endpoint: ENDPOINT });
    const post = vi.fn(() => Promise.resolve(created));

    await expect(
      subscribeToSiteAlerts({ registration, vapidPublicKey: VAPID_KEY, siteId: "s", crewId: null, post }),
    ).rejects.toThrow(/incomplete/i);
    expect(post).not.toHaveBeenCalled();
  });
});

describe("subscribeToSiteAlerts: a subscription made with another VAPID key", () => {
  // What a browser throws when subscribe() is called with a key that differs from the existing subscription's.
  const otherKey = () => new DOMException("A subscription with a different applicationServerKey already exists", "InvalidStateError");
  const deps = (registration: RegistrationLike) => ({
    registration,
    vapidPublicKey: VAPID_KEY,
    siteId: "s",
    crewId: null,
    post: () => Promise.resolve(created),
  });

  it("drops the existing subscription, then asks the browser once more", async () => {
    const old = fakeSubscription();
    const { registration, subscribe } = fakeRegistration(old);
    subscribe.mockRejectedValueOnce(otherKey());

    const outcome = await subscribeToSiteAlerts(deps(registration));

    expect(old.unsubscribe).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledTimes(2);
    expect(old.unsubscribe.mock.invocationCallOrder[0]).toBeLessThan(subscribe.mock.invocationCallOrder[1] ?? 0);
    expect(outcome.serverId).toBe("sub-1");
  });

  it("asks only once more: a second refusal is reported, not retried again", async () => {
    const { registration, subscribe } = fakeRegistration(fakeSubscription());
    subscribe.mockRejectedValue(otherKey());

    await expect(subscribeToSiteAlerts(deps(registration))).rejects.toMatchObject({ name: "InvalidStateError" });
    expect(subscribe).toHaveBeenCalledTimes(2);
  });

  it("retries even when the browser has no subscription to drop", async () => {
    const { registration, subscribe } = fakeRegistration(null);
    subscribe.mockRejectedValueOnce(otherKey());

    await expect(subscribeToSiteAlerts(deps(registration))).resolves.toMatchObject({ serverId: "sub-1" });
    expect(subscribe).toHaveBeenCalledTimes(2);
  });

  it("does not drop anything for any other refusal", async () => {
    const old = fakeSubscription();
    const { registration, subscribe } = fakeRegistration(old);
    subscribe.mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"));

    await expect(subscribeToSiteAlerts(deps(registration))).rejects.toMatchObject({ name: "NotAllowedError" });
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(old.unsubscribe).not.toHaveBeenCalled();
  });
});

describe("unsubscribe", () => {
  it("unsubscribes locally and sends DELETE for the stored server id", async () => {
    const existing = fakeSubscription();
    const { registration } = fakeRegistration(existing);
    const remove = vi.fn<(serverId: string) => Promise<Result<unknown>>>(() => Promise.resolve({ ok: true, data: undefined }));

    await unsubscribe({ registration, serverId: "sub-1", remove });

    expect(existing.unsubscribe).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith("sub-1");
  });

  it("sends no DELETE when no server id is stored", async () => {
    const existing = fakeSubscription();
    const { registration } = fakeRegistration(existing);
    const remove = vi.fn(() => Promise.resolve<Result<unknown>>({ ok: true, data: undefined }));

    await unsubscribe({ registration, serverId: null, remove });

    expect(existing.unsubscribe).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();
  });

  it("still sends DELETE when the browser holds no subscription any more", async () => {
    const { registration } = fakeRegistration(null);
    const remove = vi.fn(() => Promise.resolve<Result<unknown>>({ ok: true, data: undefined }));

    await unsubscribe({ registration, serverId: "sub-1", remove });

    expect(remove).toHaveBeenCalledWith("sub-1");
  });

  it("unsubscribes locally even when the server refuses, and then reports the failure with its request id", async () => {
    const existing = fakeSubscription();
    const { registration } = fakeRegistration(existing);
    const remove = () => Promise.resolve<Result<unknown>>({ ok: false, problem: badGateway });

    const failure = await unsubscribe({ registration, serverId: "sub-1", remove }).catch((error: unknown) => error);

    expect(existing.unsubscribe).toHaveBeenCalledTimes(1);
    expect(failure).toBeInstanceOf(ApiProblem);
    expect((failure as ApiProblem).problem.request_id).toBe("req-9");
  });

  it("still sends DELETE when the local unsubscribe throws, and then reports that failure", async () => {
    const existing = fakeSubscription(vi.fn<() => Promise<boolean>>(() => Promise.reject(new Error("push service unreachable"))));
    const { registration } = fakeRegistration(existing);
    const remove = vi.fn(() => Promise.resolve<Result<unknown>>({ ok: true, data: undefined }));

    await expect(unsubscribe({ registration, serverId: "sub-1", remove })).rejects.toThrow("push service unreachable");
    expect(remove).toHaveBeenCalledWith("sub-1");
  });
});
