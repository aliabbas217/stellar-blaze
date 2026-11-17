import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import { isUnreadableClaim } from "@/features/judge/claims";
import { loadClaims } from "@/features/judge/proof-claims";
import { ProofSheet } from "@/features/judge/ProofSheet";

/*
 * `/replay/proof/<claim>`: the proof sheet of one number. The claim ids come from the loaded data (the scored cells, the
 * season counts, the frontier readouts); an id that is not one is rendered as the empty state (an unknown number is a page,
 * not a 404), and a scored id whose result file cannot be read is rendered as a read failure (a different message).
 *
 * The page is rendered per request and never cached, for two reasons. (1) An unknown id must not grow the page cache: with
 * `dynamicParams` on (the default), a page rendered for an id outside `generateStaticParams` is stored and served from the
 * cache, so random ids would add one entry each, for ever (docs: 01-app/03-api-reference/03-file-conventions/
 * 02-route-segment-config/dynamicParams.md; `dynamicParams = false` would answer 404 instead, and there is no way to make
 * only the unknown ids dynamic: `connection()` in the fallback render fails with React error 441, found by the e2e).
 * (2) The read-failure state must reflect the file as it is NOW, which a build-time render cannot. The cost is reading the
 * small recorded files on each request; the page is still server HTML with no API call. A file that cannot be read at
 * request time (missing, replaced by a bad one) is the read-failure state of the loader that owns the id's family (claims.ts
 * `isUnreadableClaim`), never a 500. Parked trade-off: docs/parking-lot.md ("static proof route").
 */
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("judge.proof");
  return { title: t("title"), robots: { index: false } };
}

export default async function ProofPage(props: PageProps<"/[locale]/replay/proof/[claim]">) {
  const { locale, claim: raw } = await props.params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const id = decodeURIComponent(raw);
  const { claims, source, unreadable } = await loadClaims(locale);
  const claim = claims.find((candidate) => candidate.id === id) ?? null;
  return <ProofSheet claim={claim} source={source} unreadable={claim === null && isUnreadableClaim(id, unreadable)} />;
}
