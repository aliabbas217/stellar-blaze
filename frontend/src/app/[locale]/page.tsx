import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { titleWithAppName } from "@/app/titles";
import { Link } from "@/i18n/navigation";

// Placeholder entry so /<locale> is not a 404: a heading and one link per role. The role chooser's own
// design (descriptions, the no-login and synthetic-data note) is part of the screens phase.

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("shell.roleChooser");
  const common = await getTranslations("common");
  // The layout's title template reaches its child segments, not this page beside it: add the app name here.
  return { title: titleWithAppName(t("title"), common("appName")) };
}

export default async function LocaleHomePage() {
  const t = await getTranslations("shell.roleChooser");
  return (
    <main>
      <h1>{t("title")}</h1>
      <ul>
        <li>
          <Link href="/worker" className="underline">
            {t("worker.title")}
          </Link>
        </li>
        <li>
          <Link href="/supervisor" className="underline">
            {t("supervisor.title")}
          </Link>
        </li>
        <li>
          <Link href="/hse" className="underline">
            {t("hse.title")}
          </Link>
        </li>
      </ul>
    </main>
  );
}
