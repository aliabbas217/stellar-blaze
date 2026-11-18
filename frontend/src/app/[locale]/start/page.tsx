import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { FieldLink } from "@/components/shell/FieldLink";
import { MachineTranslationNotice } from "@/components/shell/MachineTranslationNotice";
import { RoleDoor } from "@/features/judge/landing/RoleDoor";

/*
 * `/start`: the front door as a page of its own (03 section 2): the four tiles of the landing hero's role door, the same component, and
 * the target of "Switch role" and "Choose another role". Static server markup with no script. It is navigation, not sign-in: nothing is
 * stored here (the staff roles are chosen on their own entry pages), and workers never need an account.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("judge.landing.door");
  return { title: t("label") };
}

export default async function StartPage() {
  const t = await getTranslations("judge");
  const common = await getTranslations("common");
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-160 flex-col px-4 sm:px-6">
      <header className="py-1">
        <FieldLink
          href="/"
          className="inline-flex min-h-(--target) items-center font-display text-sm font-semibold uppercase tracking-wordmark text-ink no-underline"
        >
          {common("appName")}
        </FieldLink>
      </header>
      <main id="main-content" className="flex flex-1 flex-col gap-6 pt-6 pb-10">
        <div className="flex flex-col gap-2">
          <h1 className="font-display text-3xl font-medium text-ink">{t("landing.door.label")}</h1>
          <p className="text-lg text-ink-2">{t("start.lead")}</p>
        </div>
        <RoleDoor />
        <p className="max-w-(--measure) text-base text-ink-2">{t("landing.door.note")}</p>
        <MachineTranslationNotice />
      </main>
    </div>
  );
}
