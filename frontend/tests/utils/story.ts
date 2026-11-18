import { buildStory, type ProofStory } from "@/components/provenance/proof-story";

/** A made-up but well-formed story, for tests that need a `Proof` and do not test the story itself. */
export const SAMPLE_STORY: ProofStory = buildStory("policy", {
  policy: "P3_protect",
  metric: "missed_danger_hours",
  lead: 1,
  station: "OMAA",
  seasonStart: "2026-05-15",
  seasonEnd: "2026-09-30",
  nDays: 139,
  marginWm2: 7,
  range: { lo: "27.0", hi: "66.0", unit: "hours" },
});
