import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import { loadClaims } from "@/features/judge/proof-claims";
import { ProofSheet } from "@/features/judge/ProofSheet";

/*
 * `/replay/proof/<claim>`: the proof sheet of one number. The claim ids come from the loaded data (the scored cells, the
 * season counts, the frontier readouts), so every number the scoreboard shows with a proof has a prerendered sheet; any
 * other id is rendered on request as the empty state (`dynamicParams` stays on: an unknown number is a page, not a 404).
 */

export async function generateStaticParams() {
  // The ids do not depend on the language; the locale layout supplies that segment.
  const { claims } = await loadClaims("en");
  return claims.map((claim) => ({ claim: claim.id }));
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("judge.proof");
  return { title: t("title"), robots: { index: false } };
}

export default async function ProofPage(props: PageProps<"/[locale]/replay/proof/[claim]">) {
  const { locale, claim: raw } = await props.params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const id = decodeURIComponent(raw);
  const { claims, source } = await loadClaims(locale);
  return <ProofSheet claim={claims.find((candidate) => candidate.id === id) ?? null} source={source} />;
}
