import { splitDemoName } from "@/components/shell/site-name";

/*
 * The header tags the synthetic demo site "Demo" instead of printing "(synthetic)" in its name (redesign S5). The suffix is taken out
 * only for a site the API itself marks synthetic: a name is never edited on a guess.
 */
describe("splitDemoName", () => {
  it("takes the trailing (synthetic) out of a site the API marks synthetic, and says it is the demo", () => {
    expect(splitDemoName("Mussafah M-14 yard (synthetic)", true)).toEqual({ name: "Mussafah M-14 yard", demo: true });
  });

  it("is case-insensitive and tolerates spaces around the suffix", () => {
    expect(splitDemoName("Mussafah M-14 yard  (Synthetic) ", true)).toEqual({ name: "Mussafah M-14 yard", demo: true });
  });

  it("tags a synthetic site whose name has no suffix, leaving the name alone", () => {
    expect(splitDemoName("Mussafah M-14 yard", true)).toEqual({ name: "Mussafah M-14 yard", demo: true });
  });

  it("never edits the name of a site that is not marked synthetic, even if it ends the same way", () => {
    expect(splitDemoName("Mussafah M-14 yard (synthetic)", false)).toEqual({ name: "Mussafah M-14 yard (synthetic)", demo: false });
    expect(splitDemoName("Mussafah M-14 yard (synthetic)", undefined)).toEqual({ name: "Mussafah M-14 yard (synthetic)", demo: false });
  });

  it("never leaves an empty name", () => {
    expect(splitDemoName("(synthetic)", true)).toEqual({ name: "(synthetic)", demo: true });
  });
});
