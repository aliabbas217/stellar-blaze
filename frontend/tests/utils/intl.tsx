import { render, type RenderResult } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement } from "react";
import enMessages from "../../messages/en.json";
import type { Messages } from "@/i18n/request";
import type { Locale } from "@/i18n/routing";

interface IntlOptions {
  readonly locale?: Locale;
  readonly messages?: Messages;
  readonly timeZone?: string;
}

/** Renders a component the way the [locale] layout does: inside NextIntlClientProvider with real messages. */
export function renderWithIntl(ui: ReactElement, options: IntlOptions = {}): RenderResult {
  const { locale = "en", messages = enMessages, timeZone = "Asia/Dubai" } = options;
  return render(
    <NextIntlClientProvider locale={locale} messages={messages} timeZone={timeZone}>
      {ui}
    </NextIntlClientProvider>,
  );
}
