import { http, HttpResponse } from "msw";
import type { components } from "@/api/schema";
import { server } from "@/mocks/node";
import { SAMPLE_STORY } from "../../../utils/story";
import {
  PROOF_LABELS,
  isIncomplete,
  proofFromForecast,
  proofFromProvenance,
  recountSha256,
  recountUrl,
  type Proof,
} from "@/components/provenance/proof";

type Provenance = components["schemas"]["Provenance"];

const PROVENANCE: Provenance = {
  protocol_path: "docs/protocol/preregistration.md",
  protocol_anchor: "#72-warnings-row",
  script: "backend.eval.policy_scoreboard",
  function: "build_policy_scoreboard",
  git_sha: "661b373a1b2c3d4e5f60718293a4b5c6d7e8f901",
  data_sha256: "a".repeat(64),
  model_id: "corrector-20261112-0000000-000001",
  label: "REAL",
  generated_at: "2026-11-12T09:14:00Z",
};

const FILE = { path: "eval/2026/policy_scoreboard.json", sha256: "b".repeat(64) };
const OPTIONS = { story: SAMPLE_STORY };

describe("proofFromProvenance", () => {
  it("builds every row of the drawer from the exporter's block", () => {
    const proof = proofFromProvenance(PROVENANCE, "#73-plans-row", "Alerts per shift", FILE, OPTIONS);
    expect(proof).toEqual<Proof>({
      what: "Alerts per shift",
      story: SAMPLE_STORY,
      protocol: "docs/protocol/preregistration.md#73-plans-row",
      protocolHref: null,
      script: "backend.eval.policy_scoreboard:build_policy_scoreboard @ 661b373a1b2c",
      file: "eval/2026/policy_scoreboard.json",
      fileSha256: "b".repeat(64),
      sourceSha256: "a".repeat(64),
      label: "REAL",
      modelId: "corrector-20261112-0000000-000001",
      generatedAt: "2026-11-12T09:14:00Z",
    });
  });

  it("falls back to the block's own protocol anchor when the metric names none", () => {
    expect(proofFromProvenance(PROVENANCE, "", "x", FILE, OPTIONS)?.protocol).toBe(
      "docs/protocol/preregistration.md#72-warnings-row",
    );
  });

  it("keeps a null model id (no model was involved)", () => {
    expect(proofFromProvenance({ ...PROVENANCE, model_id: null }, "#a", "x", FILE, OPTIONS)?.modelId).toBeNull();
  });

  it.each(["protocol_path", "script", "function", "git_sha", "data_sha256", "label", "generated_at"] as const)(
    "test_proof_from_provenance_null_when_field_missing: %s",
    (field) => {
      const incomplete: Partial<Provenance> = Object.fromEntries(
        Object.entries(PROVENANCE).filter(([key]) => key !== field),
      );
      expect(proofFromProvenance(incomplete, "#a", "x", FILE, OPTIONS)).toBeNull();
      expect(proofFromProvenance({ ...PROVENANCE, [field]: "" }, "#a", "x", FILE, OPTIONS)).toBeNull();
    },
  );

  it("is null with no block, with no anchor anywhere, and with a label the contract does not know", () => {
    expect(proofFromProvenance(null, "#a", "x", FILE, OPTIONS)).toBeNull();
    expect(proofFromProvenance(undefined, "#a", "x", FILE, OPTIONS)).toBeNull();
    expect(proofFromProvenance({ ...PROVENANCE, protocol_anchor: "" }, "", "x", FILE, OPTIONS)).toBeNull();
    expect(proofFromProvenance({ ...PROVENANCE, label: "MEASURED" as Provenance["label"] }, "#a", "x", FILE, OPTIONS)).toBeNull();
  });

  it("takes the DEV 2025 or RECORDED label from the caller: the contract's label type has neither", () => {
    expect(proofFromProvenance(PROVENANCE, "#a", "x", FILE, { ...OPTIONS, label: "DEV 2025" })?.label).toBe("DEV 2025");
    expect(proofFromProvenance(PROVENANCE, "#a", "x", FILE, { ...OPTIONS, label: "RECORDED" })?.label).toBe("RECORDED");
  });

  it.each(["eval/dev/policy_scoreboard.2025.json", "tests/fixtures/eval/policy_scoreboard.synthetic.json"])(
    "a proof built from a dev or synthetic file (%s) can never carry REAL, whatever the block says",
    (path) => {
      for (const label of ["REAL", "REAL weather + assumed crew", "SIMULATED"] as const) {
        const proof = proofFromProvenance({ ...PROVENANCE, label }, "#a", "x", { path, sha256: null }, OPTIONS);
        expect(proof?.label, `${path} / ${label}`).toBe("DEV 2025");
      }
      // The caller cannot override it either.
      expect(proofFromProvenance(PROVENANCE, "#a", "x", { path, sha256: null }, { ...OPTIONS, label: "REAL" })?.label).toBe("DEV 2025");
    },
  );

  it("has a drawer label for every label a proof can carry", () => {
    expect(Object.keys(PROOF_LABELS).sort()).toEqual(
      ["DEV 2025", "REAL", "REAL weather + assumed crew", "RECORDED", "SIMULATED"].sort(),
    );
  });
});

describe("proofFromForecast", () => {
  const forecast = {
    site_id: "site-demo-mussafah",
    date: "2026-07-01",
    policy_version: "ae-heat-2026.1",
    config_version: 3,
    model_id: "corrector-20261112-0000000-000001",
    generated_at: "2026-06-30T14:00:00Z",
  } as components["schemas"]["SiteForecastToday"];

  it("says which ruleset, configuration and model drew the level, and labels a synthetic site SIMULATED", () => {
    const proof = proofFromForecast(forecast, "Site level", { synthetic: true });
    expect(proof).toMatchObject({
      what: "Site level",
      protocol: "Ruleset ae-heat-2026.1, configuration 3",
      script: null,
      modelId: "corrector-20261112-0000000-000001",
      generatedAt: "2026-06-30T14:00:00Z",
      label: "SIMULATED",
      fileSha256: null,
      sourceSha256: null,
    });
  });

  it("never prints policy=, config= or an API operation name: the technical fields are for the auditor layer and read as words", () => {
    const proof = proofFromForecast(forecast, "Site level", { synthetic: true });
    expect(JSON.stringify([proof.protocol, proof.script, proof.story])).not.toMatch(/policy=|config=|get_site_forecast/);
    // the story of a worker's level says what it is in plain words and carries no technical field
    expect(proof.story.family).toBe("level");
    expect(proof.story.rows.map((row) => row.id)).toEqual(["madeBy", "about", "doesNotShow"]);
  });

  it("labels a real site REAL and keeps a null model id (fallback forecast)", () => {
    const proof = proofFromForecast({ ...forecast, model_id: null }, "Site level", { synthetic: false });
    expect(proof.label).toBe("REAL");
    expect(proof.modelId).toBeNull();
  });
});

describe("recountUrl", () => {
  const base: Proof = {
    what: "x",
    story: SAMPLE_STORY,
    protocol: "p",
    protocolHref: null,
    script: "s",
    file: "static/coast.json",
    fileSha256: "c".repeat(64),
    sourceSha256: null,
    label: "RECORDED",
    modelId: null,
    generatedAt: null,
  };

  it("points only at files that are published under /data", () => {
    expect(recountUrl(base)).toBe("/data/static/coast.json");
    expect(recountUrl({ ...base, file: "eval/2026/demo_day.json" })).toBe("/data/eval/2026/demo_day.json");
  });

  it("never offers a recount for a development or synthetic file, an API response or a missing fingerprint", () => {
    expect(recountUrl({ ...base, file: "eval/dev/demo_day.2025.json" })).toBeNull();
    expect(recountUrl({ ...base, file: "tests/fixtures/eval/demo_day.synthetic.json" })).toBeNull();
    expect(recountUrl({ ...base, file: "site-demo-mussafah/forecast/today/2026-07-01" })).toBeNull();
    expect(recountUrl({ ...base, file: "static/../../etc/passwd" })).toBeNull();
    expect(recountUrl({ ...base, fileSha256: null })).toBeNull();
  });
});

describe("recountSha256", () => {
  const BODY = "stellar blaze";

  const proofWith = (sha: string | null): Proof => ({
    what: "x",
    story: SAMPLE_STORY,
    protocol: "p",
    protocolHref: null,
    script: "s",
    file: "static/recount-sample.json",
    fileSha256: sha,
    sourceSha256: null,
    label: "RECORDED",
    modelId: null,
    generatedAt: null,
  });

  async function actualSha(): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(BODY));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  it("test_drawer_recount_matches_and_flags_a_changed_file: hashes the bytes the server sends", async () => {
    server.use(http.get("/data/static/recount-sample.json", () => new HttpResponse(BODY)));
    await expect(recountSha256(proofWith(await actualSha()))).resolves.toBe("match");
    await expect(recountSha256(proofWith("0".repeat(64)))).resolves.toBe("mismatch");
  });

  it("compares case-insensitively and is unavailable for a proof with nothing to recount", async () => {
    server.use(http.get("/data/static/recount-sample.json", () => new HttpResponse(BODY)));
    await expect(recountSha256(proofWith((await actualSha()).toUpperCase()))).resolves.toBe("match");
    await expect(recountSha256(proofWith(null))).resolves.toBe("unavailable");
  });

  it("rejects when the file cannot be read, so the drawer never claims a match it did not check", async () => {
    server.use(http.get("/data/static/recount-sample.json", () => new HttpResponse(null, { status: 404 })));
    await expect(recountSha256(proofWith("0".repeat(64)))).rejects.toThrow(/404/);
  });
});

describe("isIncomplete", () => {
  const base: Proof = {
    what: "x",
    story: SAMPLE_STORY,
    protocol: "p",
    protocolHref: null,
    script: "s",
    file: "eval/2026/policy_scoreboard.json",
    fileSha256: "c".repeat(64),
    sourceSha256: "d".repeat(64),
    label: "REAL",
    modelId: null,
    generatedAt: "2026-11-12T09:14:00Z",
  };

  it("is false for a complete exporter record, and for a recorded file or a live forecast whose empty fields are expected", () => {
    expect(isIncomplete(base)).toBe(false);
    expect(isIncomplete({ ...base, sourceSha256: null, fileSha256: null, generatedAt: null, label: "RECORDED" })).toBe(false);
  });

  it("is true only for an exporter-backed number that lacks the fingerprint of the file the page drew", () => {
    expect(isIncomplete({ ...base, fileSha256: null })).toBe(true);
  });
});
