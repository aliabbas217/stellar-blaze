import { policyClaim } from "@/features/judge/adapters";

/*
 * The five stops of the 3-minute tour (`/tour`), in the order a reviewer should take them: the story, the worker's phone, the crew lead's
 * screen, the refusal, the scoreboard. Each is a route of the app, written without the locale prefix as the locale-aware link takes it; the
 * unit test resolves every `href` to a real page. The words of a stop are `judge.tour.steps.<id>.{title,text}` (Tier 2, English by design).
 *
 * `proof` is the "Where from" of a stop, and exists only where a proof sheet for the same thing already exists: the story names how the
 * warnings were checked, which is the policy proof the landing's evidence chapter links to. The other stops have no chip of their own, so
 * they have no link: this page adds no number and no claim, it only points.
 */
export const TOUR_STEP_IDS = ["story", "worker", "crew", "boundary", "scoreboard"] as const;
export type TourStepId = (typeof TOUR_STEP_IDS)[number];

export interface TourStep {
  readonly id: TourStepId;
  readonly href: string;
  readonly proof?: string;
}

export const TOUR_STEPS: readonly TourStep[] = [
  { id: "story", href: "/", proof: `/replay/proof/${policyClaim("P3_protect", "missed_danger_hours")}` },
  { id: "worker", href: "/worker" },
  { id: "crew", href: "/supervisor" },
  { id: "boundary", href: "/replay/governance" },
  { id: "scoreboard", href: "/replay" },
];

/** Where the demo controls are (Replay or Live, Reset): the safety view's own section, opened by its anchor. */
export const DEMO_CONTROLS_HREF = "/hse#demo-controls";
