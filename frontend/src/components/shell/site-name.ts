/*
 * The header names the site and tags it "Demo" when it is synthetic, instead of a "(synthetic)" in the name (redesign S5, 04 section
 * 3.2). The API's demo site is named "<place> (synthetic)": the suffix is split off only for a site the API itself marks synthetic, so
 * a real site whose name happens to end that way is never edited, and the tag appears exactly when the API says the site is made up.
 */
const SYNTHETIC_SUFFIX = /\s*\(synthetic\)\s*$/i;

export function splitDemoName(name: string, synthetic: boolean | undefined): { readonly name: string; readonly demo: boolean } {
  if (synthetic !== true) return { name, demo: false };
  const stripped = name.replace(SYNTHETIC_SUFFIX, "");
  return { name: stripped === "" ? name : stripped, demo: true };
}
