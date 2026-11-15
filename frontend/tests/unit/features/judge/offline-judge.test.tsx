import { readFileSync } from "node:fs";
import path from "node:path";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { onlineManager } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { REPLAY_DATE } from "@/features/demo/constants";
import { banStateFor, SEASON_BAN } from "@/features/judge/ban";
import { REFUSED_TYPE } from "@/features/judge/governance/answer";
import { GovernanceGate } from "@/features/judge/governance/GovernanceGate";
import { GovernanceStatic } from "@/features/judge/governance/GovernanceStatic";
import { parseRecordedRun, toRecordedView } from "@/features/judge/governance/recorded";
import { TryGate } from "@/features/judge/validator/TryGate";
import { TryStatic } from "@/features/judge/validator/TryStatic";
import { server } from "@/mocks/node";
import { renderWithIntl } from "../../../utils/intl";

/*
 * Offline Try a plan and governance (Part L1, from the Task 23 offline evidence). With the network off, the demo-site lookup
 * (`list_sites`) is paused and never settles. "Offline and no demo site" is a SETTLED state, not a wait: the page says it is
 * offline (the existing offline wording), sends nothing, and keeps the RECORDED result in view (Try offers it under the same label
 * as after a failed validator call). Back online the normal flow resumes without a reload.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/en/replay/try",
}));
vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/en/replay/try",
  useRouter: () => ({ replace: vi.fn() }),
  Link: ({ href, children, ...props }: { href: string; children: ReactNode; className?: string }) => (
    <a href={`/en${href}`} {...props}>
      {children}
    </a>
  ),
}));

const { parseRecordedPlan } = await import("@/features/judge/validator/recorded-plan");

const root = path.resolve(import.meta.dirname, "../../../..");
const recordedPlan = parseRecordedPlan(JSON.parse(readFileSync(path.join(root, "data/recorded/validator-b0.json"), "utf8")) as unknown);
const recordedRun = toRecordedView(parseRecordedRun(JSON.parse(readFileSync(path.join(root, "data/recorded/governance-run.json"), "utf8")) as unknown));
const heat = Array.from({ length: 24 }, () => "oklch(0.4 0.1 300)");
const ban = banStateFor(SEASON_BAN, REPLAY_DATE, "en");
const STILL_LOADING = "The demo site is still loading. Try again in a moment.";

/** The network goes away: the browser says offline, TanStack pauses its queries, and the site lookup never answers. */
function goOffline(): { posts: string[] } {
  const posts: string[] = [];
  vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
  onlineManager.setOnline(false);
  server.use(
    http.get("*/api/v1/sites", () => new Promise<Response>(() => undefined)),
    http.post("*/api/v1/*", ({ request }) => {
      posts.push(request.url);
      return new HttpResponse(JSON.stringify({ type: REFUSED_TYPE, title: "Individual data refused", status: 403 }), { status: 403, headers: { "content-type": "application/problem+json" } });
    }),
  );
  return { posts };
}

function goOnline(): void {
  vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
  onlineManager.setOnline(true);
  act(() => {
    window.dispatchEvent(new Event("online"));
  });
}

afterEach(() => {
  onlineManager.setOnline(true);
  vi.restoreAllMocks();
});

const renderTry = () =>
  renderWithIntl(
    <TryGate date={REPLAY_DATE} heat={heat} ban={ban} dateLabel="Thu 3 Sep" recorded={recordedPlan}>
      <TryStatic heat={heat} ban={ban} dateLabel="Thu 3 Sep" recorded={recordedPlan} />
    </TryGate>,
  );

describe("Try a plan offline", () => {
  it("test_try_offline_is_settled_and_offers_the_recorded_result: says offline (not 'still loading'), sends nothing, and the recorded result opens", async () => {
    const { posts } = goOffline();
    const user = userEvent.setup();
    const { container } = renderTry();
    await user.click(screen.getByRole("button", { name: "Check this plan" }));
    expect(await screen.findByText("You are offline")).toBeInTheDocument();
    expect(screen.getByText("Showing what this phone saved.")).toBeInTheDocument();
    expect(screen.queryByText(STILL_LOADING)).toBeNull();
    expect(container.querySelector("[data-try]")).toHaveAttribute("data-try", "offline");
    // no result of a check, no spinner, nothing sent
    expect(container.querySelector("[data-answer]")).toBeNull();
    expect(screen.getByRole("button", { name: "Check this plan" })).not.toHaveAttribute("aria-busy", "true");
    expect(posts).toEqual([]);
    // the same recorded result, behind the same label as after a failed validator call
    const show = screen.getByRole("button", { name: "Show a recorded result" });
    await user.click(show);
    const block = container.querySelector("[data-recorded]");
    expect(block).not.toBeNull();
    expect(block?.querySelector("[data-answer]")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Hide the recorded result" })).toHaveAttribute("aria-pressed", "true");
    expect(posts).toEqual([]);
  });

  it("a check that is tapped again offline says the same and still sends nothing", async () => {
    const { posts } = goOffline();
    const user = userEvent.setup();
    renderTry();
    await user.click(screen.getByRole("button", { name: "Check this plan" }));
    await screen.findByText("You are offline");
    await user.click(screen.getByRole("button", { name: "Check this plan" }));
    expect(screen.getByText("You are offline")).toBeInTheDocument();
    expect(screen.queryByText(STILL_LOADING)).toBeNull();
    expect(posts).toEqual([]);
  });

  it("test_try_back_online_resumes_without_a_reload: the offline notice goes and the next check reaches the validator", async () => {
    goOffline();
    const user = userEvent.setup();
    const { container } = renderTry();
    await user.click(screen.getByRole("button", { name: "Check this plan" }));
    await screen.findByText("You are offline");
    // the network comes back, and so does the site list
    server.resetHandlers();
    const calls: unknown[] = [];
    server.use(
      http.post("*/api/v1/plans/validate", async ({ request }) => {
        calls.push(await request.clone().json());
        return undefined;
      }),
    );
    goOnline();
    await waitFor(() => {
      expect(screen.queryByText("You are offline")).toBeNull();
    });
    expect(container.querySelector("[data-try]")).toHaveAttribute("data-try", "idle");
    await screen.findByText("Mussafah M-14 yard (synthetic)");
    await user.click(screen.getByRole("button", { name: "Check this plan" }));
    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    await waitFor(() => {
      expect(container.querySelector("[data-answer]")).not.toBeNull();
    });
  });

  it("online and still looking up the site, a check still waits (the offline state does not replace the wait)", async () => {
    // the lookup is slow but the network is up: "still loading" behaviour is the island's own, covered by validator.test.tsx; here only that
    // the offline notice is NOT shown while online
    server.use(http.get("*/api/v1/sites", () => new Promise<Response>(() => undefined)));
    const user = userEvent.setup();
    const { container } = renderTry();
    await user.click(screen.getByRole("button", { name: "Check this plan" }));
    await waitFor(() => {
      expect(container.querySelector("[data-try]")).toHaveAttribute("data-try", "loading");
    });
    expect(screen.queryByText("You are offline")).toBeNull();
  });
});

describe("Governance offline", () => {
  const renderGate = () =>
    renderWithIntl(
      <GovernanceGate recorded={recordedRun}>
        <GovernanceStatic recorded={recordedRun} />
      </GovernanceGate>,
    );

  it("test_governance_offline_says_offline_not_still_loading: the live send says it is offline, sends nothing, and the recorded run stays in view", async () => {
    const { posts } = goOffline();
    const user = userEvent.setup();
    const { container } = renderGate();
    await user.click(screen.getByRole("button", { name: "Send the employer's request" }));
    expect(await screen.findByText("You are offline")).toBeInTheDocument();
    expect(screen.queryByText(STILL_LOADING)).toBeNull();
    expect(container.querySelector("[data-governance]")).toHaveAttribute("data-governance", "recorded");
    expect(container.querySelector("[data-answer=shown] [data-status]")).toHaveTextContent("403");
    expect(posts).toEqual([]);
    // back online the notice goes
    goOnline();
    await waitFor(() => {
      expect(screen.queryByText("You are offline")).toBeNull();
    });
  });
});
