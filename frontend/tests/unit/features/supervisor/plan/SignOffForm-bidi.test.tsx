import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw/http";
import type { ReactNode } from "react";
import ar from "../../../../../messages/ar.json";
import en from "../../../../../messages/en.json";
import ur from "../../../../../messages/ur.json";
import SignOffForm from "@/features/supervisor/plan/SignOffForm";
import type { PlanAckItem } from "@/features/supervisor/plan/derive-ack";
import { server } from "@/mocks/node";
import type { Messages } from "@/i18n/request";
import type { Locale } from "@/i18n/routing";
import { renderWithIntl } from "../../../../utils/intl";
import { installSupervisorTestEnvironment } from "../support";

/*
 * Task 22 fix round 1 (architect follow-up): the sign-off screen builds two sentences in code from a list of items ("N items need a
 * tick: Plan zone X, 06:00 to 09:00, and ..." and, after a 409, "These items still need a tick: ..."). The items were joined as plain
 * strings, so in Urdu and Arabic the clocks sat bare inside right-to-left text, where a neutral colon or a following number can
 * reorder them. Every clock time is an isolate (<bdi>) of its own, in the intro line, the "still need a tick" line and the checkbox
 * label alike, and keeps its digits in order.
 */

// The two mocks every supervisor test file needs (support.tsx imports the whole screens, whose Link and search params are the app's).
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/en/supervisor/crews/crew-b",
}));
vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/en/supervisor/crews/crew-b",
  useRouter: () => ({ replace: vi.fn() }),
  Link: ({ href, children, prefetch, ...props }: { href: string; children: ReactNode; prefetch?: boolean; className?: string }) => (
    <a href={`/en${href}`} data-prefetch={String(prefetch)} {...props}>
      {children}
    </a>
  ),
}));

installSupervisorTestEnvironment();

const SIGN_OFF = "*/api/v1/crews/:crew_id/day-plan/sign-off";
const ITEMS: readonly PlanAckItem[] = [
  { id: "medium-0600", zone: "medium", startsAt: "2026-09-03T02:00:00Z", endsAt: "2026-09-03T05:00:00Z", textCode: null },
  { id: "high-1000", zone: "high", startsAt: "2026-09-03T06:00:00Z", endsAt: "2026-09-03T07:00:00Z", textCode: "cycle.high.heavy.20-40" },
  { id: "red-1100", zone: "red", startsAt: "2026-09-03T07:00:00Z", endsAt: "2026-09-03T08:00:00Z", textCode: null },
];
const CLOCK = /^\d{2}:\d{2}$/;
const CLOCK_ANYWHERE = /\d{2}:\d{2}/;

function renderForm(locale: Locale, messages: unknown) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return renderWithIntl(
    <QueryClientProvider client={client}>
      <SignOffForm crewId="crew-b" date="2026-09-03" items={ITEMS} zone="Asia/Dubai" />
    </QueryClientProvider>,
    { locale, messages: messages as Messages },
  );
}

/** Every `hh:mm` the element shows, as the text of the element that owns it; a clock sitting bare in running text is reported. */
function clocksIn(element: Element): { readonly isolated: string[]; readonly bare: string[] } {
  const isolated: string[] = [];
  const bare: string[] = [];
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node.textContent ?? "";
    if (!CLOCK_ANYWHERE.test(text)) continue;
    const owner = node.parentElement;
    if (owner?.closest("bdi, time, [dir='ltr']") !== null && CLOCK.test(text.trim())) isolated.push(text.trim());
    else bare.push(text);
  }
  return { isolated, bare };
}

describe.each([
  ["ur", ur],
  ["ar", ar],
] as const)("sign-off clocks are isolated in %s", (locale, messages) => {
  it("test_signoff_intro_clocks_are_bdi: the list sentence has each item's two clocks in a <bdi>, in order, none bare", () => {
    renderForm(locale, messages);
    const line = document.querySelector("[data-sign-off-items]");
    expect(line).not.toBeNull();
    const { isolated, bare } = clocksIn(line as Element);
    expect(bare, "a clock sits bare in running text").toEqual([]);
    expect(isolated).toEqual(["06:00", "09:00", "10:00", "11:00", "11:00", "12:00"]);
    // The sentence is still one sentence with every item in it (the isolates must not drop the wording around them).
    expect((line as Element).textContent).toContain(messages.supervisor.plan.zone.red);
  });

  it("test_signoff_missing_clocks_are_bdi: after a 409 the 'still need a tick' sentence isolates its clocks too", async () => {
    server.use(
      http.post(SIGN_OFF, () =>
        HttpResponse.json(
          { title: "x", request_id: "req-1", type: "urn:stellar-blaze:problem:review-required", status: 409, missing_items: ["high-1000", "red-1100"] },
          { status: 409, headers: { "content-type": "application/problem+json" } },
        ),
      ),
    );
    const user = userEvent.setup();
    renderForm(locale, messages);
    for (const box of screen.getAllByRole("checkbox")) await user.click(box);
    await user.click(screen.getByRole("button", { name: messages.supervisor.plan.signOff.submit }));

    const message = await waitFor(() => {
      const element = document.querySelector("[data-sign-off-message]");
      expect(element?.textContent).toMatch(CLOCK_ANYWHERE);
      return element as Element;
    });
    const { isolated, bare } = clocksIn(message);
    expect(bare, "a clock sits bare in running text").toEqual([]);
    expect(isolated).toEqual(["10:00", "11:00", "11:00", "12:00"]);
  });

  it("the checkbox labels keep their clocks isolated (they already were: the guard that they stay)", () => {
    renderForm(locale, messages);
    for (const label of document.querySelectorAll("label")) expect(clocksIn(label).bare).toEqual([]);
  });
});

describe("the English sentence reads the same as before", () => {
  it("joins the items with the language's own list words, the clocks isolated as well", () => {
    renderForm("en", en);
    const line = document.querySelector("[data-sign-off-items]") as Element;
    expect(line.textContent.replace(/\s+/g, " ").trim()).toBe(
      "3 items need a tick: Plan zone Medium, 06:00 to 09:00, Plan zone High, 10:00 to 11:00, and Plan zone Red, 11:00 to 12:00.",
    );
    expect(clocksIn(line).bare).toEqual([]);
  });
});
