import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import ar from "../../../../messages/ar.json";
import en from "../../../../messages/en.json";
import { ENDPOINT_HOST_NOT_ALLOWED_TYPE } from "@/api/problem";
import { CONSENT_VERSION } from "@/features/profile/profile-shape";
import { PROFILE_STORAGE_KEY, useProfile, type RevokeOutcome } from "@/features/profile/store";
import { AlertsSettings, type AlertsSettingsProps } from "@/features/push/AlertsSettings";
import type { PushEnv } from "@/features/push/capability";
import { clearRevokeIncomplete, INCOMPLETE_KEY, markRevokeIncomplete } from "@/features/profile/revoke-marker";
import type { UsePush } from "@/features/push/usePush";
import { renderWithIntl } from "../../../utils/intl";

/*
 * The Alerts screen's content for every state the plan names: what the phone can do, the Enable and Turn off buttons,
 * denied, the iPhone install steps, the always-visible closed-app limitation, the "remove my data" control the consent
 * copy promises (ruling R7), and the spike's debug panel. The state machine and the environment are replaced (they have
 * their own tests); this checks what each of them puts on screen.
 */

const hoisted = vi.hoisted(() => ({
  env: undefined as unknown as { value: PushEnv },
  push: undefined as unknown as { value: UsePush },
  /** How many times the alerts state machine was mounted: removing the data starts it again from the browser's state. */
  mounts: 0,
  /**
   * When set, the real store's clearing of Cache Storage (its slowest, most visible step) waits for this instead. It lets a
   * test hold a REAL removal in flight, with the real marker written, and look at the screen meanwhile.
   */
  cacheGate: null as (() => Promise<void>) | null,
}));

vi.mock("@/features/pwa/api-cache", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/features/pwa/api-cache")>();
  return {
    ...original,
    clearDeviceCaches: (...args: Parameters<typeof original.clearDeviceCaches>) =>
      hoisted.cacheGate === null ? original.clearDeviceCaches(...args) : hoisted.cacheGate(),
  };
});

vi.mock("@/features/push/usePush", () => ({
  usePush: () => {
    useEffect(() => {
      hoisted.mounts += 1;
    }, []);
    return hoisted.push.value;
  },
}));
vi.mock("@/features/push/capability", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/push/capability")>()),
  readPushEnv: () => hoisted.env.value,
}));

const supportedEnv: PushEnv = {
  isSecureContext: true,
  hasServiceWorker: true,
  hasPushManager: true,
  hasNotification: true,
  isIos: false,
  isStandalone: false,
};

const SUBSCRIPTION = { endpoint: "https://push.example/send/abc123", expirationTime: null, keys: { p256dh: "p", auth: "a" } };

function pushState(overrides: Partial<UsePush> = {}): UsePush {
  return {
    state: "idle",
    subscription: null,
    problem: null,
    failure: null,
    enable: vi.fn(() => Promise.resolve()),
    disable: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

function setup(env: Partial<PushEnv>, push: Partial<UsePush> = {}, props: Partial<AlertsSettingsProps> = {}, locale: "en" | "ar" = "en") {
  hoisted.env = { value: { ...supportedEnv, ...env } };
  hoisted.push = { value: pushState(push) };
  renderWithIntl(<AlertsSettings vapidPublicKey="key" siteId="site-demo-mussafah" debug={false} {...props} />, {
    locale,
    ...(locale === "ar" ? { messages: ar } : {}),
  });
  return hoisted.push.value;
}

const enable = () => screen.queryByRole("button", { name: en.alerts.enable });
const disable = () => screen.queryByRole("button", { name: en.alerts.disable });
const removeData = () => screen.queryByRole("button", { name: en.alerts.removeData.button });
/** The buttons of the alerts controls: every button except the one that removes the worker's data. */
const alertButtons = () => screen.queryAllByRole("button").filter((button) => button !== removeData());

beforeEach(() => {
  hoisted.mounts = 0;
  clearRevokeIncomplete();
});

describe("AlertsSettings: what the phone can do", () => {
  it("explains an insecure address and offers no button", () => {
    setup({ isSecureContext: false });
    expect(screen.getByRole("heading", { name: en.alerts.insecure.title })).toBeInTheDocument();
    expect(screen.getByText(en.alerts.insecure.body)).toBeInTheDocument();
    expect(alertButtons()).toHaveLength(0);
  });

  it("explains a browser without push and offers no button", () => {
    setup({ hasPushManager: false });
    expect(screen.getByRole("heading", { name: en.alerts.unsupported.title })).toBeInTheDocument();
    expect(screen.getByText(en.alerts.unsupported.body)).toBeInTheDocument();
    expect(alertButtons()).toHaveLength(0);
  });

  it("shows the install steps on an iPhone browser tab, as a numbered list, and no Enable button", () => {
    setup({ isIos: true, isStandalone: false, hasPushManager: false });
    expect(screen.getByRole("heading", { name: en.alerts.install.title })).toBeInTheDocument();
    const steps = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(steps.map((step) => step.textContent)).toEqual([en.alerts.install.step1, en.alerts.install.step2, en.alerts.install.step3]);
    expect(enable()).not.toBeInTheDocument();
  });
});

describe("AlertsSettings: supported", () => {
  it("idle: says alerts are off and offers Enable, which calls enable", async () => {
    const push = setup({});
    expect(screen.getByText(en.alerts.state.idle)).toBeInTheDocument();
    await userEvent.click(enable() as HTMLElement);
    expect(push.enable).toHaveBeenCalledTimes(1);
  });

  it("idle without a site: Enable is disabled and the screen says a site is needed", () => {
    setup({}, {}, { siteId: null });
    expect(enable()).toBeDisabled();
    expect(screen.getByText(en.alerts.noSite)).toBeInTheDocument();
  });

  it("subscribed: says alerts are on and offers Turn off, which calls disable", async () => {
    const push = setup({}, { state: "subscribed", subscription: SUBSCRIPTION });
    expect(screen.getByText(en.alerts.state.subscribed)).toBeInTheDocument();
    expect(enable()).not.toBeInTheDocument();
    await userEvent.click(disable() as HTMLElement);
    expect(push.disable).toHaveBeenCalledTimes(1);
  });

  it("denied: explains how to turn alerts back on in the browser's settings, with no Enable button", () => {
    setup({}, { state: "denied" });
    expect(screen.getByRole("heading", { name: en.alerts.denied.title })).toBeInTheDocument();
    expect(screen.getByText(en.alerts.denied.body)).toBeInTheDocument();
    expect(alertButtons()).toHaveLength(0);
  });

  it("requesting: one disabled button that says to wait", () => {
    setup({}, { state: "requesting" });
    const buttons = alertButtons();
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toBeDisabled();
    expect(buttons[0]).toHaveTextContent(en.alerts.working);
  });

  it("error while turning on: the failure, the request id, and Enable again", () => {
    setup({}, { state: "error", failure: "enable", problem: { type: "about:blank", title: "Bad Gateway", status: 502, request_id: "req-42" } });
    expect(screen.getByText(en.alerts.state.error)).toBeInTheDocument();
    expect(screen.getByText(en.states.error.requestId.replace("{id}", "req-42"))).toBeInTheDocument();
    expect(enable()).toBeEnabled();
  });

  // B3 ba912f3 (ADR 0067): the push service of this browser is not on the API's allow-list. Said plainly, not as a generic failure
  // to try again; the request id still shows, and nothing throws.
  it("error while turning on because the push service is not allowed: says so plainly, with the request id", () => {
    setup({}, { state: "error", failure: "enable", problem: { type: ENDPOINT_HOST_NOT_ALLOWED_TYPE, title: "Endpoint host not allowed", status: 422, request_id: "req-43" } });
    expect(screen.getByText(en.alerts.state.hostNotAllowed)).toBeInTheDocument();
    expect(screen.queryByText(en.alerts.state.error)).not.toBeInTheDocument();
    expect(screen.getByText(en.states.error.requestId.replace("{id}", "req-43"))).toBeInTheDocument();
  });

  it("an ordinary 422 while turning on is still the generic failure", () => {
    setup({}, { state: "error", failure: "enable", problem: { type: "about:blank", title: "Unprocessable Content", status: 422, request_id: "req-44" } });
    expect(screen.getByText(en.alerts.state.error)).toBeInTheDocument();
    expect(screen.queryByText(en.alerts.state.hostNotAllowed)).not.toBeInTheDocument();
  });

  it("says the push service is not allowed in Arabic from the Arabic messages", () => {
    setup(
      {},
      { state: "error", failure: "enable", problem: { type: ENDPOINT_HOST_NOT_ALLOWED_TYPE, title: "Endpoint host not allowed", status: 422 } },
      {},
      "ar",
    );
    expect(screen.getByText(ar.alerts.state.hostNotAllowed)).toBeInTheDocument();
  });

  it("error while turning off: says so, and offers Turn off again", () => {
    setup({}, { state: "error", failure: "disable" });
    expect(screen.getByText(en.alerts.state.disableError)).toBeInTheDocument();
    expect(disable()).toBeEnabled();
    expect(enable()).not.toBeInTheDocument();
  });

  it("announces a change of state through a live region", () => {
    setup({}, { state: "subscribed", subscription: SUBSCRIPTION });
    // More than one live region on the screen now (the removal result has its own): find the one that holds the state.
    const region = screen.getAllByRole("status").find((candidate) => within(candidate).queryByText(en.alerts.state.subscribed) !== null);
    expect(region).toBeDefined();
  });

  it("gives every button a 48 px target (min-h-12), above the 44 px a gloved hand needs", () => {
    setup({});
    for (const button of screen.getAllByRole("button")) expect(button.className).toContain("min-h-12");
  });
});

describe("AlertsSettings: the closed-app limitation", () => {
  it.each([
    ["insecure", { isSecureContext: false }, {}],
    ["unsupported", { hasServiceWorker: false }, {}],
    ["ios-needs-install", { isIos: true, hasPushManager: false }, {}],
    ["idle", {}, {}],
    ["subscribed", {}, { state: "subscribed" as const }],
    ["denied", {}, { state: "denied" as const }],
    ["error", {}, { state: "error" as const, failure: "enable" as const }],
  ])("is visible when %s", (_name, env, push) => {
    setup(env, push);
    expect(screen.getByText(en.alerts.limitation)).toBeInTheDocument();
  });

  it("is the ADR 0004 wording, in English", () => {
    setup({});
    expect(en.alerts.limitation).toBe(
      "When the app is closed you get site and crew warnings only. Your personal risk shows when you open the app or tap a warning. It is worked out on this phone and never sent to the server.",
    );
  });

  it("is shown in Arabic from the Arabic messages", () => {
    setup({}, {}, {}, "ar");
    expect(screen.getByText(ar.alerts.limitation)).toBeInTheDocument();
  });
});

describe("AlertsSettings: removing the worker's data", () => {
  const realRevoke = useProfile.getState().revoke;
  const realResume = useProfile.getState().resume;

  /** A revoke that resolves with `outcome`; `useProfile.setState` swaps it in for the real one. */
  function stubRevoke(outcome: RevokeOutcome = { failed: [], pending: false }) {
    const revoke = vi.fn(() => Promise.resolve(outcome));
    useProfile.setState({ revoke });
    return revoke;
  }

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    hoisted.cacheGate = null;
    useProfile.setState({ revoke: realRevoke, resume: realResume, profile: null, push: null });
    clearRevokeIncomplete();
  });

  it.each([
    ["insecure", { isSecureContext: false }, {}],
    ["unsupported", { hasServiceWorker: false }, {}],
    ["ios-needs-install", { isIos: true, hasPushManager: false }, {}],
    ["idle", {}, {}],
    ["subscribed", {}, { state: "subscribed" as const }],
    ["denied", {}, { state: "denied" as const }],
    ["error", {}, { state: "error" as const, failure: "disable" as const }],
  ])("is offered, with what it does, when %s: the consent copy promises it from Alerts", (_name, env, push) => {
    stubRevoke();
    setup(env, push);
    expect(removeData()).toBeEnabled();
    expect(screen.getByText(en.alerts.removeData.hint)).toBeInTheDocument();
  });

  it("is disabled while a tap on Enable or Turn off is running, so it cannot race the registration", () => {
    stubRevoke();
    setup({}, { state: "requesting" });
    expect(removeData()).toBeDisabled();
  });

  it("asks before it removes anything: the first tap only shows the question, with the safe answer focused", async () => {
    const revoke = stubRevoke();
    setup({});

    await userEvent.click(removeData() as HTMLElement);

    expect(revoke).not.toHaveBeenCalled();
    const group = screen.getByRole("group", { name: en.alerts.removeData.confirmTitle });
    expect(within(group).getByRole("button", { name: en.alerts.removeData.cancel })).toHaveFocus();
    expect(within(group).getByRole("button", { name: en.alerts.removeData.confirm })).toBeEnabled();
    expect(removeData()).not.toBeInTheDocument();
  });

  it("'No, keep it' goes back to the button, with focus on it, and removes nothing", async () => {
    const revoke = stubRevoke();
    setup({});
    await userEvent.click(removeData() as HTMLElement);

    await userEvent.click(screen.getByRole("button", { name: en.alerts.removeData.cancel }));

    expect(revoke).not.toHaveBeenCalled();
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
    expect(removeData()).toHaveFocus();
    expect(screen.queryByText(en.alerts.removeData.done)).not.toBeInTheDocument();
  });

  it("'Yes, remove it' removes the data once, says so in a live region, and starts the alerts screen again", async () => {
    const revoke = stubRevoke();
    setup({}, { state: "subscribed", subscription: SUBSCRIPTION });
    expect(hoisted.mounts).toBe(1);

    await userEvent.click(removeData() as HTMLElement);
    await userEvent.click(screen.getByRole("button", { name: en.alerts.removeData.confirm }));

    expect(revoke).toHaveBeenCalledTimes(1);
    const done = await screen.findByText(en.alerts.removeData.done);
    expect(done).toHaveAttribute("role", "status");
    expect(screen.queryByText(en.alerts.removeData.failed)).not.toBeInTheDocument();
    // The state machine of the alerts section was rebuilt, so it reads the browser's state again (no stale "subscribed").
    expect(hoisted.mounts).toBe(2);
    expect(removeData()).toHaveFocus();
  });

  it("shows that it is working, and offers nothing else, until the removal finishes", async () => {
    let finish: (outcome: RevokeOutcome) => void = () => undefined;
    useProfile.setState({
      revoke: () =>
        new Promise<RevokeOutcome>((resolve) => {
          finish = resolve;
        }),
    });
    setup({});
    await userEvent.click(removeData() as HTMLElement);
    await userEvent.click(screen.getByRole("button", { name: en.alerts.removeData.confirm }));

    expect(screen.queryByRole("group")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: en.alerts.working })).toBeDisabled();
    expect(screen.queryByText(en.alerts.removeData.done)).not.toBeInTheDocument();

    finish({ failed: [], pending: false });
    expect(await screen.findByText(en.alerts.removeData.done)).toBeInTheDocument();
    expect(removeData()).toBeEnabled();
  });

  it("says plainly when alerts may still be on, and keeps the alerts screen as it is so Turn off can be tried again", async () => {
    stubRevoke({ failed: ["alerts"], pending: false });
    setup({}, { state: "subscribed", subscription: SUBSCRIPTION });

    await userEvent.click(removeData() as HTMLElement);
    await userEvent.click(screen.getByRole("button", { name: en.alerts.removeData.confirm }));

    expect(await screen.findByText(en.alerts.removeData.failed)).toBeInTheDocument();
    expect(screen.queryByText(en.alerts.removeData.done)).not.toBeInTheDocument();
    expect(hoisted.mounts).toBe(1);
    expect(disable()).toBeEnabled();
  });

  it.each([["cache"], ["storage"]] as const)(
    "says it could not finish when only the %s step failed, and still starts the alerts screen again",
    async (step) => {
      stubRevoke({ failed: [step], pending: false });
      setup({});

      await userEvent.click(removeData() as HTMLElement);
      await userEvent.click(screen.getByRole("button", { name: en.alerts.removeData.confirm }));

      expect(await screen.findByText(en.alerts.removeData.failed)).toBeInTheDocument();
      expect(hoisted.mounts).toBe(2);
    },
  );

  it("does not break the screen if the removal throws", async () => {
    useProfile.setState({ revoke: () => Promise.reject(new Error("unexpected")) });
    setup({});

    await userEvent.click(removeData() as HTMLElement);
    await userEvent.click(screen.getByRole("button", { name: en.alerts.removeData.confirm }));

    expect(await screen.findByText(en.alerts.removeData.failed)).toBeInTheDocument();
    expect(removeData()).toBeEnabled();
  });

  it("is not 'done' while the API has not confirmed deleting the registration: it says what is outstanding", async () => {
    stubRevoke({ failed: [], pending: true });
    setup({}, { state: "subscribed", subscription: SUBSCRIPTION });

    await userEvent.click(removeData() as HTMLElement);
    await userEvent.click(screen.getByRole("button", { name: en.alerts.removeData.confirm }));

    expect(await screen.findByText(en.alerts.removeData.pending)).toBeInTheDocument();
    expect(screen.queryByText(en.alerts.removeData.done)).not.toBeInTheDocument();
    expect(screen.queryByText(en.alerts.removeData.failed)).not.toBeInTheDocument();
    // The browser's subscription is gone, so the alerts section starts again from it.
    expect(hoisted.mounts).toBe(2);
  });

  it("says it could not finish, not 'pending', when a step failed as well as the registration being unconfirmed", async () => {
    stubRevoke({ failed: ["cache"], pending: true });
    setup({});

    await userEvent.click(removeData() as HTMLElement);
    await userEvent.click(screen.getByRole("button", { name: en.alerts.removeData.confirm }));

    expect(await screen.findByText(en.alerts.removeData.failed)).toBeInTheDocument();
    expect(screen.queryByText(en.alerts.removeData.done)).not.toBeInTheDocument();
    expect(screen.queryByText(en.alerts.removeData.pending)).not.toBeInTheDocument();
  });

  it("shows the result in one live region that is never replaced: the same node, its text changing, so it is announced (WCAG 4.1.3)", async () => {
    stubRevoke();
    setup({}, { state: "subscribed", subscription: SUBSCRIPTION });
    const regions = screen.getAllByRole("status");
    const region = regions[regions.length - 1] as HTMLElement;
    expect(region).toBeEmptyDOMElement();

    await userEvent.click(removeData() as HTMLElement);
    await userEvent.click(screen.getByRole("button", { name: en.alerts.removeData.confirm }));

    await waitFor(() => {
      expect(region).toHaveTextContent(en.alerts.removeData.done);
    });
    // The alerts section was rebuilt around it, and the region is still the very same element, still in the page.
    expect(hoisted.mounts).toBe(2);
    expect(region.isConnected).toBe(true);
    expect(screen.getAllByRole("status").at(-1)).toBe(region);
  });

  it("keeps the same live region when the result changes from one removal to the next", async () => {
    const revoke = vi.fn().mockResolvedValueOnce({ failed: ["cache"], pending: false }).mockResolvedValueOnce({ failed: [], pending: false });
    useProfile.setState({ revoke });
    setup({});
    const regions = screen.getAllByRole("status");
    const region = regions[regions.length - 1] as HTMLElement;

    await userEvent.click(removeData() as HTMLElement);
    await userEvent.click(screen.getByRole("button", { name: en.alerts.removeData.confirm }));
    await waitFor(() => {
      expect(region).toHaveTextContent(en.alerts.removeData.failed);
    });
    await userEvent.click(removeData() as HTMLElement);
    await userEvent.click(screen.getByRole("button", { name: en.alerts.removeData.confirm }));
    await waitFor(() => {
      expect(region).toHaveTextContent(en.alerts.removeData.done);
    });
    expect(screen.getAllByRole("status").at(-1)).toBe(region);
  });

  it("finishes an unfinished revoke each time Alerts opens (resume), once, and not again when the section is rebuilt after a removal", async () => {
    const resume = vi.fn(() => Promise.resolve(null));
    useProfile.setState({ resume, revoke: vi.fn(() => Promise.resolve({ failed: [], pending: false })) });

    setup({ isSecureContext: false });
    expect(resume).toHaveBeenCalledTimes(1);

    await userEvent.click(removeData() as HTMLElement);
    await userEvent.click(screen.getByRole("button", { name: en.alerts.removeData.confirm }));
    await screen.findByText(en.alerts.removeData.done);

    expect(resume).toHaveBeenCalledTimes(1);
  });

  it("says the data may remain when a removal was left unfinished, from the marker alone, with no removal on this page (a reload)", async () => {
    markRevokeIncomplete(["cache"]);
    useProfile.setState({ resume: vi.fn(() => Promise.resolve(null)) });

    setup({});

    expect(await screen.findByText(en.alerts.removeData.failed)).toBeInTheDocument();
    expect(screen.queryByText(en.alerts.removeData.done)).not.toBeInTheDocument();
  });

  it("says only the registration is outstanding when the marker names no step", async () => {
    markRevokeIncomplete([]);
    useProfile.setState({ resume: vi.fn(() => Promise.resolve(null)) });

    setup({});

    expect(await screen.findByText(en.alerts.removeData.pending)).toBeInTheDocument();
    expect(screen.queryByText(en.alerts.removeData.failed)).not.toBeInTheDocument();
  });

  it("says nothing about a removal when there is no marker and nothing was removed here", () => {
    useProfile.setState({ resume: vi.fn(() => Promise.resolve(null)) });
    setup({});
    const regions = screen.getAllByRole("status");
    expect(regions[regions.length - 1]).toBeEmptyDOMElement();
  });

  it("shows the marker's message in the same live region that announces a removal, and keeps it across a rebuild", async () => {
    markRevokeIncomplete(["cache"]);
    useProfile.setState({ resume: vi.fn(() => Promise.resolve(null)) });
    setup({});
    const regions = screen.getAllByRole("status");
    const region = regions[regions.length - 1] as HTMLElement;
    await waitFor(() => {
      expect(region).toHaveTextContent(en.alerts.removeData.failed);
    });

    // The worker tries again and it fails the same way: the message stays, in the same node.
    useProfile.setState({ revoke: vi.fn(() => Promise.resolve<RevokeOutcome>({ failed: ["cache"], pending: false })) });
    await userEvent.click(removeData() as HTMLElement);
    await userEvent.click(screen.getByRole("button", { name: en.alerts.removeData.confirm }));

    await waitFor(() => {
      expect(hoisted.mounts).toBe(2);
    });
    expect(region).toHaveTextContent(en.alerts.removeData.failed);
    expect(screen.getAllByRole("status").at(-1)).toBe(region);
  });

  it("turns the message to 'done' when the retry on open finishes everything, in the same node", async () => {
    markRevokeIncomplete(["cache"]);
    useProfile.setState({
      resume: vi.fn(() => {
        clearRevokeIncomplete();
        return Promise.resolve({ failed: [], pending: false });
      }),
    });

    setup({});

    expect(await screen.findByText(en.alerts.removeData.done)).toHaveAttribute("role", "status");
    expect(screen.queryByText(en.alerts.removeData.failed)).not.toBeInTheDocument();
  });

  it("keeps saying so when the retry on open could not finish either", async () => {
    markRevokeIncomplete(["cache", "alerts"]);
    useProfile.setState({ resume: vi.fn(() => Promise.resolve({ failed: ["alerts"], pending: false } as const)) });

    setup({});

    expect(await screen.findByText(en.alerts.removeData.failed)).toBeInTheDocument();
    expect(screen.queryByText(en.alerts.removeData.done)).not.toBeInTheDocument();
  });

  it("follows the marker when another tab clears it (a storage event), so a stale warning does not stay", async () => {
    markRevokeIncomplete(["cache"]);
    useProfile.setState({ resume: vi.fn(() => Promise.resolve(null)) });
    setup({});
    await screen.findByText(en.alerts.removeData.failed);

    clearRevokeIncomplete();

    await waitFor(() => {
      expect(screen.queryByText(en.alerts.removeData.failed)).not.toBeInTheDocument();
    });
  });

  /** Every text the live region that carries the result of a removal ever holds, in order, from now on. */
  function watchResultRegion() {
    const regions = screen.getAllByRole("status");
    const region = regions[regions.length - 1] as HTMLElement;
    const history = [region.textContent];
    const observer = new MutationObserver(() => {
      history.push(region.textContent);
    });
    observer.observe(region, { childList: true, characterData: true, subtree: true });
    return {
      region,
      history,
      stop: () => {
        observer.disconnect();
      },
    };
  }

  const failures = [en.alerts.removeData.failed, en.alerts.removeData.pending];

  it("with the REAL store, never announces a failure while a removal is still running, and ends on done", async () => {
    let open: () => void = () => undefined;
    const hold = new Promise<void>((resolve) => {
      open = resolve;
    });
    hoisted.cacheGate = () => hold;
    setup({});
    const { region, history, stop } = watchResultRegion();

    await userEvent.click(removeData() as HTMLElement);
    await userEvent.click(screen.getByRole("button", { name: en.alerts.removeData.confirm }));

    // In flight: the screen says so. The marker is already written and names every step as unfinished, which is exactly
    // what a screen reading it without knowing a removal is running would announce as a failure.
    await waitFor(() => {
      expect(region).toHaveTextContent(en.alerts.removeData.removing);
    });
    expect(JSON.parse(localStorage.getItem(INCOMPLETE_KEY) ?? "null")).toMatchObject({ steps: ["storage", "alerts", "cache"] });
    expect(failures).not.toContain(region.textContent);

    open();
    await waitFor(() => {
      expect(region).toHaveTextContent(en.alerts.removeData.done);
    });
    stop();
    for (const text of history) {
      expect(failures, `the region held "${text}"`).not.toContain(text);
      expect(["", en.alerts.removeData.removing, en.alerts.removeData.done]).toContain(text);
    }
    expect(history).toContain(en.alerts.removeData.removing);
    expect(localStorage.getItem(INCOMPLETE_KEY)).toBeNull();
  });

  it("with the REAL store, says 'could not finish' only once a removal has actually failed", async () => {
    hoisted.cacheGate = () => Promise.reject(new Error("quota"));
    setup({});
    const { region, history, stop } = watchResultRegion();

    await userEvent.click(removeData() as HTMLElement);
    await userEvent.click(screen.getByRole("button", { name: en.alerts.removeData.confirm }));

    await waitFor(() => {
      expect(region).toHaveTextContent(en.alerts.removeData.failed);
    });
    stop();
    // Whatever the region held before that, it was never "failed" ahead of the removing status.
    const firstFailure = history.indexOf(en.alerts.removeData.failed);
    expect(history.slice(0, firstFailure)).not.toContain(en.alerts.removeData.failed);
    expect(history.slice(0, firstFailure)).toContain(en.alerts.removeData.removing);
  });

  it("with the REAL store, does not announce 'could not finish' while the retry on open is still running, and ends on done", async () => {
    markRevokeIncomplete(["cache"]);
    let open: () => void = () => undefined;
    const hold = new Promise<void>((resolve) => {
      open = resolve;
    });
    hoisted.cacheGate = () => hold;
    // The region exists from the first render; the marker is already there when the page opens.
    setup({});
    const { region, history, stop } = watchResultRegion();

    await waitFor(() => {
      expect(region).toHaveTextContent(en.alerts.removeData.removing);
    });
    expect(failures).not.toContain(region.textContent);

    open();
    await waitFor(() => {
      expect(region).toHaveTextContent(en.alerts.removeData.done);
    });
    stop();
    for (const text of history) expect(failures, `the region held "${text}"`).not.toContain(text);
    expect(localStorage.getItem(INCOMPLETE_KEY)).toBeNull();
  });

  it("with the REAL store, keeps saying it could not finish when the retry on open fails too, after saying it was trying", async () => {
    markRevokeIncomplete(["cache"]);
    hoisted.cacheGate = () => Promise.reject(new Error("quota"));
    setup({});
    const { region, history, stop } = watchResultRegion();

    await waitFor(() => {
      expect(region).toHaveTextContent(en.alerts.removeData.failed);
    });
    stop();
    const firstFailure = history.indexOf(en.alerts.removeData.failed);
    expect(history.slice(0, firstFailure)).not.toContain(en.alerts.removeData.failed);
  });

  it("says nothing about a marker until the retry on open has had its say (no failure flashed before it starts)", async () => {
    markRevokeIncomplete(["cache"]);
    let release: (outcome: null) => void = () => undefined;
    useProfile.setState({
      resume: () =>
        new Promise<null>((resolve) => {
          release = resolve;
        }),
    });
    setup({});
    const regions = screen.getAllByRole("status");
    const region = regions[regions.length - 1] as HTMLElement;

    expect(region).toBeEmptyDOMElement();
    release(null);
    await waitFor(() => {
      expect(region).toHaveTextContent(en.alerts.removeData.failed);
    });
  });

  it("gives the question's buttons the same 48 px target (min-h-12) as every other button", async () => {
    stubRevoke();
    setup({});
    expect(removeData()?.className).toContain("min-h-12");

    await userEvent.click(removeData() as HTMLElement);
    for (const button of within(screen.getByRole("group")).getAllByRole("button")) expect(button.className).toContain("min-h-12");
  });

  it("is shown in Arabic from the Arabic messages", async () => {
    stubRevoke();
    setup({}, {}, {}, "ar");

    await userEvent.click(screen.getByRole("button", { name: ar.alerts.removeData.button }));

    expect(screen.getByRole("group", { name: ar.alerts.removeData.confirmTitle })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ar.alerts.removeData.confirm })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ar.alerts.removeData.cancel })).toBeInTheDocument();
  });

  it("removes the real stored profile and push registration (the store's own revoke, in jsdom)", async () => {
    useProfile.getState().save({
      consentVersion: CONSENT_VERSION,
      consentedAt: "2026-11-11T08:30:00.000Z",
      siteId: "site-demo-mussafah",
      crewId: null,
      workloadClass: "light",
      heatWorkStartDate: "2026-10-01",
      clothingCode: "work_clothes",
    });
    useProfile.getState().setPush({ serverId: "sub-1", endpoint: "https://push.example/send/abc", siteId: "site-demo-mussafah" });
    expect(localStorage.getItem(PROFILE_STORAGE_KEY)).not.toBeNull();
    setup({});

    await userEvent.click(removeData() as HTMLElement);
    await userEvent.click(screen.getByRole("button", { name: en.alerts.removeData.confirm }));

    expect(await screen.findByText(en.alerts.removeData.done)).toBeInTheDocument();
    expect(localStorage.getItem(PROFILE_STORAGE_KEY)).toBeNull();
    expect(useProfile.getState().profile).toBeNull();
    expect(useProfile.getState().push).toBeNull();
  });
});

describe("AlertsSettings: debug panel (?debug=push)", () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, "share");
    Reflect.deleteProperty(navigator, "clipboard");
  });

  it("is absent without the debug switch, even with a subscription", () => {
    setup({}, { state: "subscribed", subscription: SUBSCRIPTION });
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("is absent with the switch while the browser holds no subscription", () => {
    setup({}, {}, { debug: true });
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("shows the subscription JSON, with the endpoint, in a read-only left-to-right textarea", () => {
    setup({}, { state: "subscribed", subscription: SUBSCRIPTION }, { debug: true }, "ar");
    const box = screen.getByRole("textbox", { name: ar.alerts.debug.heading });
    expect(box).toHaveAttribute("readonly");
    expect(box).toHaveAttribute("dir", "ltr");
    expect(JSON.parse((box as HTMLTextAreaElement).value)).toEqual(SUBSCRIPTION);
    expect((box as HTMLTextAreaElement).value).toContain(SUBSCRIPTION.endpoint);
  });

  it("Copy writes the JSON to the clipboard and says it did", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    setup({}, { state: "subscribed", subscription: SUBSCRIPTION }, { debug: true });

    await userEvent.click(screen.getByRole("button", { name: en.alerts.debug.copy }));

    expect(writeText).toHaveBeenCalledWith(JSON.stringify(SUBSCRIPTION, null, 2));
    expect(await screen.findByText(en.alerts.debug.copied)).toBeInTheDocument();
  });

  it("Copy selects the text for a manual copy when the Clipboard API refuses", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: () => Promise.reject(new Error("blocked")) },
      configurable: true,
    });
    setup({}, { state: "subscribed", subscription: SUBSCRIPTION }, { debug: true });
    const box = screen.getByRole<HTMLTextAreaElement>("textbox");

    await userEvent.click(screen.getByRole("button", { name: en.alerts.debug.copy }));

    expect(screen.queryByText(en.alerts.debug.copied)).not.toBeInTheDocument();
    expect(box.selectionStart).toBe(0);
    expect(box.selectionEnd).toBe(box.value.length);
  });

  it("Copy selects the text when there is no Clipboard API at all", async () => {
    setup({}, { state: "subscribed", subscription: SUBSCRIPTION }, { debug: true });
    const box = screen.getByRole<HTMLTextAreaElement>("textbox");

    await userEvent.click(screen.getByRole("button", { name: en.alerts.debug.copy }));

    expect(box.selectionEnd).toBe(box.value.length);
  });

  it("does not offer Share where the browser cannot share", () => {
    setup({}, { state: "subscribed", subscription: SUBSCRIPTION }, { debug: true });
    expect(screen.queryByRole("button", { name: en.alerts.debug.share })).not.toBeInTheDocument();
  });

  it("Share hands the JSON to navigator.share", async () => {
    const share = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    setup({}, { state: "subscribed", subscription: SUBSCRIPTION }, { debug: true });

    await userEvent.click(screen.getByRole("button", { name: en.alerts.debug.share }));

    expect(share).toHaveBeenCalledWith({ text: JSON.stringify(SUBSCRIPTION, null, 2) });
  });
});
