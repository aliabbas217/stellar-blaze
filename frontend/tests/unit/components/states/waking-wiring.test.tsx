import { act, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { banStateFor, SEASON_BAN } from "@/features/judge/ban";
import { DaySkeleton } from "@/features/judge/DaySkeleton";
import { ScoreboardSkeleton } from "@/features/judge/ScoreboardSkeleton";
import { AnswerCard } from "@/features/judge/governance/AnswerCard";
import { TryPlanLayout } from "@/features/judge/validator/TryPlanLayout";
import { templateRuns } from "@/features/judge/validator/runs";
import { AlertSkeleton } from "@/features/alert/AlertView";
import { CrewsSkeleton } from "@/features/supervisor/CrewsView";
import { PlanSkeleton } from "@/features/supervisor/plan/PlanView";
import { SiteEntry } from "@/features/today/SiteEntry";
import { TodaySkeleton } from "@/features/today/TodayView";
import { REPLAY_DATE } from "@/features/demo/constants";
import { renderWithIntl } from "../../../utils/intl";

/*
 * Where the "waking up" line is, and where it is not. It belongs to the loading state of a screen that WAITS ON THE BFF: worker
 * Today (and the site list it starts from), the alert card, the supervisor crews list and crew plan, and the judge's two live
 * calls (try a plan, the data request of the governance page). It does not belong to a static page built from committed JSON (the
 * scoreboard and day loading states), whose data never waits on the API, nor to a state that is not loading.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/en/replay/try",
}));
vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/en/replay/try",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  Link: ({ href, children, ...props }: { href: string; children: ReactNode; className?: string }) => (
    <a href={`/en${href}`} {...props}>
      {children}
    </a>
  ),
}));

const SENTENCE = "Waking up the service. The first load after a quiet period can take longer.";
const heat = Array.from({ length: 24 }, () => "oklch(0.4 0.1 300)");

function tryLoading(phase: "loading" | "idle") {
  return (
    <TryPlanLayout
      phase={phase}
      runs={templateRuns("common")}
      rowProblems={[null, null, null]}
      templateId="common"
      acclimatised
      daysPerWeek="6"
      daysProblem={false}
      heat={heat}
      ban={banStateFor(SEASON_BAN, REPLAY_DATE, "en")}
      dateLabel="Thu 3 Sep"
      siteName={null}
      answer={null}
      invalidLines={[]}
      requestId={null}
      recorded={null}
      showRecorded={false}
      locale="en"
      modeSwitch={null}
    />
  );
}

const noop = () => undefined;

const LIVE: readonly (readonly [string, () => ReactNode])[] = [
  ["worker Today", () => <TodaySkeleton />],
  ["the worker's site list (Today before a site is chosen)", () => <SiteEntry status="loading" onDemoYard={noop} onRetry={noop} />],
  ["the alert card", () => <AlertSkeleton />],
  ["the supervisor crews list", () => <CrewsSkeleton />],
  ["the supervisor crew plan", () => <PlanSkeleton />],
  ["the judge's try a plan, while the check runs", () => tryLoading("loading")],
  ["the judge's governance request, while the call runs", () => <AnswerCard answer={null} pending />],
];

const NOT_LIVE: readonly (readonly [string, () => ReactNode])[] = [
  ["the scoreboard's loading state (committed JSON)", () => <ScoreboardSkeleton />],
  ["the day's loading state (committed JSON)", () => <DaySkeleton />],
  ["the site list once it failed", () => <SiteEntry status="unavailable" onDemoYard={noop} onRetry={noop} />],
  ["the site list once a demo site is known", () => <SiteEntry status="ready" onDemoYard={noop} onRetry={noop} />],
  ["try a plan before anything is pressed", () => tryLoading("idle")],
  ["the governance answer when not pending", () => <AnswerCard answer={null} pending={false} />],
];

/** The live regions that carry the sentence, from the document. */
function wakingRegions(): HTMLElement[] {
  return screen.queryAllByRole("status").filter((region) => region.textContent === SENTENCE);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe.each(LIVE)("%s", (_name, render) => {
  it("shows no line at first, the line at 3 s, and is not an error", () => {
    renderWithIntl(<>{render()}</>);
    expect(wakingRegions()).toHaveLength(0);

    act(() => void vi.advanceTimersByTime(2999));
    expect(wakingRegions()).toHaveLength(0);

    act(() => void vi.advanceTimersByTime(1));
    expect(wakingRegions()).toHaveLength(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("puts the line outside every busy region (a change inside one is not announced)", () => {
    renderWithIntl(<>{render()}</>);
    act(() => void vi.advanceTimersByTime(3000));

    const [line] = wakingRegions();
    expect(line?.closest("[aria-busy='true']")).toBeNull();
  });
});

describe.each(NOT_LIVE)("%s", (_name, render) => {
  it("never carries the line", () => {
    renderWithIntl(<>{render()}</>);
    act(() => void vi.advanceTimersByTime(60_000));

    expect(wakingRegions()).toHaveLength(0);
    expect(document.querySelector("[data-waking]")).toBeNull();
  });
});
