import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { SUPERVISOR_NAMESPACES, WORKER_APP_NAMESPACES, WORKER_SHEET_NAMESPACES } from "@/i18n/client-namespaces";
import { pickMessages } from "@/i18n/pick-messages";
import { routing } from "@/i18n/routing";

/*
 * F2 W3.1 (a): a field route group gives its client components only the namespaces they read (src/i18n/ClientMessages.tsx).
 * A namespace a client component reads that its group does not list would render a raw key on a phone, so this scans the
 * components each group mounts for their literal namespaces. A bare `useTranslations()` (FieldShell) is checked through the
 * full keys it passes to `t(...)`.
 */

const SRC = join(process.cwd(), "src");

function filesIn(path: string): string[] {
  const full = join(SRC, path);
  if (!statSync(full).isDirectory()) return [full];
  return readdirSync(full, { withFileTypes: true }).flatMap((entry) => filesIn(join(path, entry.name)));
}

const covers = (paths: readonly string[], ns: string) => paths.some((path) => ns === path || ns.startsWith(`${path}.`));

function namespacesRead(files: readonly string[]): { readonly file: string; readonly ns: string }[] {
  const found: { file: string; ns: string }[] = [];
  for (const file of files.filter((f) => /\.tsx?$/.test(f))) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/(?:useTranslations|getTranslations)\(\s*"([^"]+)"\s*\)/g)) found.push({ file, ns: match[1] ?? "" });
    if (/useTranslations\(\s*\)/.test(source)) for (const match of source.matchAll(/\bt\(\s*"([a-zA-Z0-9_.]+)"/g)) found.push({ file, ns: match[1] ?? "" });
  }
  return found;
}

const SHELL = ["components/shell/FieldShell.tsx", "components/shell/SunToggle.tsx", "components/shell/FieldHeading.tsx"];
const SHARED = ["components/states", "components/level", "components/spine"];

const surfaces = {
  "worker app": {
    paths: WORKER_APP_NAMESPACES,
    files: [
      "features/today",
      "features/alert",
      "features/push",
      "features/demo",
      "components/provenance/ProofChip.tsx",
      "components/provenance/ProofDrawer.tsx",
      "components/provenance/ModeStamp.tsx",
      "components/shell/WorkerDock.tsx",
      "components/shell/DraftBadge.tsx",
      ...SHELL,
      ...SHARED,
    ],
  },
  "worker sheet": {
    paths: WORKER_SHEET_NAMESPACES,
    files: ["features/unwell", "components/shell/WorkerDock.tsx", ...SHELL, ...SHARED],
  },
  supervisor: {
    paths: SUPERVISOR_NAMESPACES,
    files: [
      "features/supervisor",
      "features/demo",
      "components/provenance/ModeStamp.tsx",
      "components/shell/SyntheticDemoBanner.tsx",
      "components/shell/ResetDemoControl.tsx",
      "components/shell/ResetDemoButton.tsx",
      ...SHELL,
      ...SHARED,
    ],
  },
} as const;

describe("client message namespaces of the field route groups", () => {
  for (const [name, { paths, files }] of Object.entries(surfaces)) {
    it(`${name}: every namespace its client components read is in the group's list`, () => {
      const read = namespacesRead(files.flatMap(filesIn));
      expect(read.length).toBeGreaterThan(5);
      const missing = read.filter(({ ns }) => !covers(paths, ns)).map(({ file, ns }) => `${file.slice(SRC.length + 1)}: ${ns}`);
      expect(missing).toEqual([]);
    });

    it(`${name}: every listed path exists in all six catalogues`, async () => {
      for (const locale of routing.locales) {
        const catalogue = (await import(`../../../messages/${locale}.json`)) as { default: Parameters<typeof pickMessages>[0] };
        expect(() => pickMessages(catalogue.default, paths), locale).not.toThrow();
      }
    });
  }

  it("the lists leave out the judge's own namespaces (the point: 6.9 KB gzip the field routes never read)", () => {
    for (const { paths } of Object.values(surfaces)) {
      const listed: readonly string[] = paths;
      for (const leftOut of ["judge", "hse", "offline", "profile"]) expect(listed).not.toContain(leftOut);
    }
  });
});
