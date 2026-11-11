import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ar from "../../../../messages/ar.json";
import en from "../../../../messages/en.json";
import { AlertsSettings, type AlertsSettingsProps } from "@/features/push/AlertsSettings";
import type { PushEnv } from "@/features/push/capability";
import type { UsePush } from "@/features/push/usePush";
import { renderWithIntl } from "../../../utils/intl";

/*
 * The Alerts screen's content for every state the plan names: what the phone can do, the Enable and Turn off buttons,
 * denied, the iPhone install steps, the always-visible closed-app limitation, and the spike's debug panel. The state
 * machine and the environment are replaced (they have their own tests); this checks what each of them puts on screen.
 */

const hoisted = vi.hoisted(() => ({
  env: undefined as unknown as { value: PushEnv },
  push: undefined as unknown as { value: UsePush },
}));

vi.mock("@/features/push/usePush", () => ({ usePush: () => hoisted.push.value }));
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

describe("AlertsSettings: what the phone can do", () => {
  it("explains an insecure address and offers no button", () => {
    setup({ isSecureContext: false });
    expect(screen.getByRole("heading", { name: en.alerts.insecure.title })).toBeInTheDocument();
    expect(screen.getByText(en.alerts.insecure.body)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("explains a browser without push and offers no button", () => {
    setup({ hasPushManager: false });
    expect(screen.getByRole("heading", { name: en.alerts.unsupported.title })).toBeInTheDocument();
    expect(screen.getByText(en.alerts.unsupported.body)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
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
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("requesting: one disabled button that says to wait", () => {
    setup({}, { state: "requesting" });
    const buttons = screen.getAllByRole("button");
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

  it("error while turning off: says so, and offers Turn off again", () => {
    setup({}, { state: "error", failure: "disable" });
    expect(screen.getByText(en.alerts.state.disableError)).toBeInTheDocument();
    expect(disable()).toBeEnabled();
    expect(enable()).not.toBeInTheDocument();
  });

  it("announces a change of state through a live region", () => {
    setup({}, { state: "subscribed", subscription: SUBSCRIPTION });
    expect(within(screen.getByRole("status")).getByText(en.alerts.state.subscribed)).toBeInTheDocument();
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
