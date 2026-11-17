import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { SEASON_BAN } from "@/features/judge/ban";

/*
 * Drift guard for the recorded ban window. The scoreboard is static and reads no API, so `SEASON_BAN` is a recorded value;
 * the contract is the only authority it may be compared with. This test parses the `BanWindow` of the OpenAPI document
 * (its example, and the exact values the field descriptions state) and fails the moment they differ. It does not compare
 * against the mock API: the mock is a second copy of the same literal and would drift with it.
 */

const frontendRoot = path.resolve(import.meta.dirname, "../../../..");
const openapi = z
  .object({
    components: z.object({
      schemas: z.object({
        BanWindow: z.object({
          examples: z.array(
            z.object({ start: z.string(), end: z.string(), season_start: z.string(), season_end: z.string(), timezone: z.string() }),
          ).min(1),
          properties: z.record(z.string(), z.object({ description: z.string() })),
        }),
      }),
    }),
  })
  .parse(JSON.parse(readFileSync(path.join(frontendRoot, "openapi/stellar-blaze.openapi.json"), "utf8")) as unknown);
const banWindow = openapi.components.schemas.BanWindow;

describe("SEASON_BAN against the contract", () => {
  it("equals the BanWindow example in the OpenAPI document", () => {
    const example = banWindow.examples[0];
    expect(example).toBeDefined();
    expect(SEASON_BAN).toEqual({
      season_start: example?.season_start,
      season_end: example?.season_end,
      start: example?.start,
      end: example?.end,
    });
  });

  it("equals the values the contract's own field descriptions state", () => {
    const stated = (field: string): string | undefined => /\(([^)]+)\)\.?$/.exec(banWindow.properties[field]?.description ?? "")?.[1];
    expect(stated("start")).toBe(SEASON_BAN.start);
    expect(stated("end")).toBe(SEASON_BAN.end);
    expect(stated("season_start")).toBe(SEASON_BAN.season_start);
    expect(stated("season_end")).toBe(SEASON_BAN.season_end);
  });
});

describe("the catalogues build the midday break from SEASON_BAN, not from a literal", () => {
  const dir = path.join(frontendRoot, "messages");
  // Locale files only: messages/review-manifest.json (F2 Task 22) sits in the same folder and is not a catalogue.
  const files = readdirSync(dir).filter((f) => /^[a-z]{2}\.json$/.test(f));

  it("finds the six catalogues", () => {
    expect(files.sort()).toEqual(["ar.json", "bn.json", "en.json", "hi.json", "ne.json", "ur.json"]);
  });

  it.each(["ar", "bn", "en", "hi", "ne", "ur"])("%s: the P0 row carries {start} and {end}, and no catalogue string states the ban hours", (locale) => {
    const text = readFileSync(path.join(dir, `${locale}.json`), "utf8");
    const messages = JSON.parse(text) as { judge: { scoreboard: { warnings: { policies: { P0: { sub: string } } } } } };
    const sub = messages.judge.scoreboard.warnings.policies.P0.sub;
    expect(sub).toContain("{start}");
    expect(sub).toContain("{end}");
    expect(text).not.toContain(SEASON_BAN.start);
    expect(text).not.toContain(SEASON_BAN.end);
  });
});
