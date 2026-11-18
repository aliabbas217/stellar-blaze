import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { HSE_NAMESPACES, SUPERVISOR_NAMESPACES, WORKER_APP_NAMESPACES, WORKER_JOIN_NAMESPACES, WORKER_SHEET_NAMESPACES } from "@/i18n/client-namespaces";
import { pickMessages } from "@/i18n/pick-messages";
import { routing } from "@/i18n/routing";

/*
 * F2 W3.1 (a): a field route group gives its client components only the namespaces they read (src/i18n/ClientMessages.tsx).
 * A namespace a client component reads that its group does not list would render a raw key on a phone, so this scans the
 * components each group mounts for their literal namespaces. A bare `useTranslations()` (FieldShell) is checked through the
 * full keys it passes to `t(...)`.
 *
 * The scan is DERIVED, not a hand-kept list (F2 W4): the shared components are every file under `src/components` that calls
 * `useTranslations`, less an explicit deny list of what a surface never mounts; and a test demands that EVERY file under
 * `src/components` and `src/features` that reads translations belongs to a surface or to a declared other surface (the judge's
 * desk). A new component, or a new feature folder (My data, say), is therefore scanned by default or fails until someone
 * decides where it lives: it can no longer be added without its namespaces being checked.
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

/** What a field surface never mounts: the desk shell and everything the judge's desk draws. Anything else under components/ is scanned. */
const DESK_ONLY = [
  "components/charts",
  "components/governance",
  "components/ui",
  "components/provenance/ScoreboardTable.tsx",
  "components/provenance/Verdict.tsx",
  "components/shell/DeskShell.tsx",
  "components/shell/StoryNav.tsx",
  "components/shell/CopyStepLink.tsx",
  "components/shell/LocaleSwitcher.tsx",
  "components/shell/DemoModeSwitch.tsx",
];
/** The proof drawer (`judge.proof`): the worker app mounts it; the supervisor screens and the unwell sheet do not. */
const PROOF = ["components/provenance/ProofChip.tsx", "components/provenance/ProofDrawer.tsx", "components/provenance/ProofRows.tsx"];
/** The worker dock: the worker app and the unwell sheet; the supervisor has its own Stop bar instead. */
const DOCK = ["components/shell/WorkerDock.tsx"];

/** Every file under src/components that reads translations, less the paths in `except` (a path is a file or a folder). */
function sharedComponents(except: readonly string[]): string[] {
  const skip = except.map((path) => join(SRC, path));
  return filesIn("components").filter((file) => /\.tsx?$/.test(file) && /(?:useTranslations|getTranslations)\(/.test(readFileSync(file, "utf8")) && !skip.some((path) => file === path || file.startsWith(`${path}/`) || file.startsWith(`${path}\\`)));
}

const surfaces = {
  "worker app": {
    paths: WORKER_APP_NAMESPACES,
    features: ["features/today", "features/alert", "features/push", "features/demo"],
    shared: sharedComponents([...DESK_ONLY]),
  },
  "worker sheet": {
    paths: WORKER_SHEET_NAMESPACES,
    features: ["features/unwell"],
    shared: sharedComponents([...DESK_ONLY, ...PROOF]),
  },
  // The join page (S6a): the shell with the language pill and the state components, plus its own copy. No dock, no proof drawer, no levels.
  "worker join": {
    paths: WORKER_JOIN_NAMESPACES,
    features: ["features/join"],
    shared: sharedComponents([...DESK_ONLY, ...PROOF, ...DOCK, "components/level", "components/states/EmptyState.tsx"]),
  },
  supervisor: {
    paths: SUPERVISOR_NAMESPACES,
    features: ["features/supervisor", "features/demo"],
    shared: sharedComponents([...DESK_ONLY, ...PROOF, ...DOCK]),
  },
  // The safety view's own client code sits in its route group (src/app/[locale]/(hse)), which this scan does not read: its namespaces are
  // `hse`, `states` and `shell`, kept right by the e2e console gate. What it mounts from shared code and the demo feature is scanned here.
  "safety view": {
    paths: HSE_NAMESPACES,
    features: ["features/demo"],
    shared: sharedComponents([...DESK_ONLY, ...PROOF, ...DOCK]),
  },
} as const;

const OTHER_SURFACES = ["features/judge", ...DESK_ONLY];

describe("client message namespaces of the field route groups", () => {
  for (const [name, { paths, features, shared }] of Object.entries(surfaces)) {
    it(`${name}: every namespace its client components read is in the group's list`, () => {
      const read = namespacesRead([...features.flatMap(filesIn), ...shared]);
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

  it("every file under components/ and features/ that reads translations belongs to a surface or to a declared other surface", () => {
    const accounted = new Set<string>([
      ...Object.values(surfaces).flatMap(({ features, shared }) => [...features.flatMap(filesIn), ...shared]),
      ...OTHER_SURFACES.flatMap(filesIn),
    ]);
    const reading = [...filesIn("components"), ...filesIn("features")].filter(
      (file) => /\.tsx?$/.test(file) && /(?:useTranslations|getTranslations)\(/.test(readFileSync(file, "utf8")),
    );
    const unaccounted = reading.filter((file) => !accounted.has(file)).map((file) => file.slice(SRC.length + 1));
    // A new feature folder (My data, a new screen) lands here until it is given a surface (add its folder to that surface's
    // `features`) or declared another surface (OTHER_SURFACES): the choice is made once, and its namespaces are checked from then on.
    expect(unaccounted).toEqual([]);
  });

  it("the lists leave out the judge's own namespaces (the point: 6.9 KB gzip the field routes never read)", () => {
    for (const [name, { paths }] of Object.entries(surfaces)) {
      const listed: readonly string[] = paths;
      // The safety view reads its own `hse` namespace, so only the others leave it out.
      for (const leftOut of name === "safety view" ? ["judge", "offline"] : ["judge", "hse", "offline"]) expect(listed, name).not.toContain(leftOut);
    }
  });

  it("the supervisor screens read no proof copy, so the supervisor list does not carry it (W4)", () => {
    expect(SUPERVISOR_NAMESPACES.some((path) => path.startsWith("judge"))).toBe(false);
  });
});
