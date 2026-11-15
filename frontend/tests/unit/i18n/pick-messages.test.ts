import { pickMessages } from "@/i18n/pick-messages";

const catalogue = {
  _meta: { review_status: "draft" },
  common: { appName: "Stellar Blaze", other: "x" },
  judge: { proof: { title: "Proof" }, scoreboard: { title: "Scoreboard" } },
  worker: { nav: { today: "Today" }, unwell: { title: "Unwell" } },
};

describe("pickMessages", () => {
  it("keeps a whole namespace for a top-level key and nothing else", () => {
    expect(pickMessages(catalogue, ["common"])).toEqual({ common: catalogue.common });
  });

  it("keeps only the named branch for a dotted path", () => {
    expect(pickMessages(catalogue, ["judge.proof"])).toEqual({ judge: { proof: { title: "Proof" } } });
  });

  it("merges several paths into one namespace without losing either", () => {
    expect(pickMessages(catalogue, ["worker.nav", "worker.unwell"])).toEqual({ worker: { nav: { today: "Today" }, unwell: { title: "Unwell" } } });
  });

  it("does not mutate the catalogue", () => {
    const before = JSON.stringify(catalogue);
    pickMessages(catalogue, ["judge.proof", "worker"]);
    expect(JSON.stringify(catalogue)).toBe(before);
  });

  it("throws for a path that is not there, so a renamed namespace fails loudly", () => {
    expect(() => pickMessages(catalogue, ["nope"])).toThrow(/"nope" is not in the catalogue/);
    expect(() => pickMessages(catalogue, ["judge.nope"])).toThrow(/"judge.nope"/);
    expect(() => pickMessages(catalogue, ["common.appName.deeper"])).toThrow(/is not in the catalogue/);
  });
});
