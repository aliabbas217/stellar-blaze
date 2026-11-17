import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fixedHeightOnText } from "../../utils/fixed-height-scan";

/*
 * F2 Task 22, test_no_fixed_height_on_text. Urdu and Arabic text sits at a line height of 2.5 and Nastaliq reaches further above and
 * below the line than Latin does, so a box with a fixed height around words clips them (Review Focus 4). This scans every component
 * and view of the field, supervisor and judge surfaces for a Tailwind `h-*`, `size-*` or inline `height` on an element that holds
 * text, and fails on each hit. A hit that is right (a one-line label whose height is set from the leading token, say) says so in a
 * `fixed-height-ok: <why>` comment on the element's line or the line above, which the scan accepts.
 */

const SRC = join(process.cwd(), "src");
const SCANNED = ["components", "features", "app/[locale]"];
// Not product surfaces: the design kit and the specimen draw type on purpose at fixed sizes; shadcn primitives are not used by a field page.
const SKIPPED = ["app/[locale]/dev", "components/ui"];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : name.endsWith(".tsx") ? [path] : [];
  });
}
const rel = (path: string) => path.slice(SRC.length + 1).replaceAll("\\", "/");

describe("test_no_fixed_height_on_text", () => {
  it("no element that holds text has a fixed height, in the field, supervisor and judge components", () => {
    const paths = SCANNED.flatMap((dir) => files(join(SRC, dir))).filter((path) => !SKIPPED.some((skip) => rel(path).startsWith(skip)));
    expect(paths.length, "the scan finds the source files").toBeGreaterThan(80);
    const hits = paths.flatMap((path) => fixedHeightOnText(readFileSync(path, "utf8"), path).map((hit) => `${rel(path)}:${String(hit.line)} <${hit.tag}> ${hit.fixed}`));
    expect(hits).toEqual([]);
  });

  describe("the scan itself (an empty result above means something)", () => {
    it("flags a fixed height on an element with text, a heading, a button label, and an inline style", () => {
      expect(fixedHeightOnText('const a = <div className="h-10 w-full">Hello</div>;')).toHaveLength(1);
      expect(fixedHeightOnText('const a = <p className="sm:h-12">x</p>;')).toHaveLength(1);
      expect(fixedHeightOnText('const a = <span className="h-(--row)">{t("x")}</span>;')).toHaveLength(1);
      expect(fixedHeightOnText("const a = <h2 className={`max-[899px]:h-90 ${x}`} />;")).toHaveLength(1);
      expect(fixedHeightOnText("const a = <button className=\"size-11\">{label}</button>;")).toHaveLength(1);
      expect(fixedHeightOnText("const a = <div style={{ height: 40 }}>Hi</div>;")).toHaveLength(1);
      expect(fixedHeightOnText('const a = <div className={open ? "h-6" : "h-0"}>Hi</div>;')).toHaveLength(1);
    });

    it("leaves a box with no text, min and max heights, auto, and a justified hit alone", () => {
      expect(fixedHeightOnText('const a = <div className="relative h-80"><svg /></div>;')).toEqual([]);
      expect(fixedHeightOnText('const a = <div className="h-6">{cond ? <i /> : null}</div>;')).toEqual([]);
      expect(fixedHeightOnText('const a = <p className="min-h-11 max-h-40">x</p>;')).toEqual([]);
      expect(fixedHeightOnText('const a = <div style={{ height: "auto" }}>Hi</div>;')).toEqual([]);
      expect(fixedHeightOnText('// fixed-height-ok: one line, height comes from the leading token\nconst a = <p className="h-9">x</p>;')).toEqual([]);
      expect(fixedHeightOnText('const a = <p className="h-9">x</p>; // fixed-height-ok: a single digit')).toEqual([]);
    });

    it("a justification with no reason does not count", () => {
      expect(fixedHeightOnText('// fixed-height-ok:\nconst a = <p className="h-9">x</p>;')).toHaveLength(1);
    });
  });
});
