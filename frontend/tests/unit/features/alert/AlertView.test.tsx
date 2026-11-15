import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw/http";
import type { ReactNode } from "react";
import type { components } from "@/api/schema";
import type { AlertParams } from "@/features/alert/alert-params";
import { AlertView } from "@/features/alert/AlertView";
import { DemoProvider } from "@/features/demo/DemoProvider";
import { CONSENT_VERSION, type Profile } from "@/features/profile/profile-shape";
import { resetSitePinForTests } from "@/features/profile/site-pin";
import { useProfile } from "@/features/profile/store";
import { legacyForecastToday as forecastToday, SITE_DEMO } from "@/mocks/fixtures";
import { server } from "@/mocks/node";
import { renderWithIntl } from "../../../utils/intl";

/*
 * The alert card against the mock API (F2 Task 17): what a tap on a warning shows, through the real hooks. The replay clock is
 * 3 Sep 2026 at 11:10; the mock day is Amber at 09:00, Orange from 10:00 to 14:00, Red at 14:00.
 */

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/en/worker/alert",
}));
vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/en/worker/alert",
  useRouter: () => ({ replace: vi.fn() }),
  Link: ({ href, children, prefetch, ...props }: { href: string; children: ReactNode; prefetch?: boolean; className?: string }) => (
    <a href={`/en${href}`} data-prefetch={String(prefetch)} {...props}>
      {children}
    </a>
  ),
}));

type Forecast = components["schemas"]["SiteForecastToday"];

const orangeFromTen: AlertParams = { audience: "site", targetId: SITE_DEMO, level: "orange", validFrom: "2026-09-03T06:00:00Z" };
const amberFromNine: AlertParams = { audience: "site", targetId: SITE_DEMO, level: "amber", validFrom: "2026-09-03T05:00:00Z" };

function renderAlert(params: AlertParams) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } } });
  return renderWithIntl(
    <QueryClientProvider client={client}>
      <DemoProvider>
        <AlertView params={params} />
      </DemoProvider>
    </QueryClientProvider>,
  );
}

const profile: Profile = {
  consentVersion: CONSENT_VERSION,
  consentedAt: "2026-09-01T08:30:00.000Z",
  siteId: SITE_DEMO,
  crewId: null,
  workloadClass: "moderate",
  heatWorkStartDate: "2026-09-03",
  clothingCode: "work_clothes",
};

/** Matches the one `<p>` whose full text is `text`, however many elements the text is spread over. */
function whole(text: string) {
  return (_content: string, element: Element | null): boolean => element?.tagName === "P" && element.textContent === text;
}

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  window.localStorage.clear();
  resetSitePinForTests();
  useProfile.setState({ site: null, push: null, profile: null });
});

describe("AlertView", () => {
  it("shows the level from when, what changed, what to do, and one primary action to Today", async () => {
    renderAlert(orangeFromTen);

    expect(await screen.findByRole("heading", { name: "Orange" })).toBeInTheDocument();
    expect(screen.getByText("Site heat warning")).toBeInTheDocument();
    expect(within(document.querySelector("[data-level-sign]") as HTMLElement).getByText(/from/).textContent).toContain("10:00");
    // The level names sit in <bdi> (a name in another script keeps its direction), so the sentence is spread over elements.
    expect(screen.getByText(whole("Was Amber, now Orange"))).toBeInTheDocument();
    expect(document.querySelectorAll("p bdi")).not.toHaveLength(0);

    const lines = screen.getByRole("region", { name: "What to do" });
    expect(within(lines).getAllByRole("listitem")).toHaveLength(3);
    expect(within(lines).getByText("Work 20 min, rest 40 min in shade")).toBeInTheDocument();
    expect(within(lines).getByText("Drink water")).toBeInTheDocument();
    expect(within(lines).getByText("Never work alone")).toBeInTheDocument();

    const primary = document.querySelectorAll("[data-primary]");
    expect(primary).toHaveLength(1);
    expect(primary[0]).toHaveTextContent("Got it");
    expect(primary[0]).toHaveAttribute("href", "/en/worker");
    expect(primary[0]).toHaveAttribute("data-prefetch", "false");
    expect(await screen.findByRole("button", { name: "Why Orange?" })).toBeInTheDocument();
  });

  it("frames the changed window on a horizontal spine and dims the rest (no quantity of water anywhere)", async () => {
    renderAlert(orangeFromTen);
    await screen.findByRole("heading", { name: "Orange" });

    const bracket = document.querySelector("[data-changed-spine]");
    expect(bracket).toHaveAttribute("data-from", "10");
    expect(bracket).toHaveAttribute("data-to", "14");
    expect(bracket?.querySelector('[data-spine][data-orientation="h"]')).not.toBeNull();
    expect(bracket?.querySelector("[data-changed-frame]")).not.toBeNull();
    // The cells outside 10:00 to 14:00 recede through one style rule; the window's own cells do not.
    const rule = bracket?.querySelector("style")?.textContent ?? "";
    expect(rule).toContain('[data-cell="9"]');
    expect(rule).toContain('[data-cell="14"]');
    expect(rule).not.toContain('[data-cell="11"]');
    expect(document.body.textContent).not.toMatch(/litre|1\.2/i);
  });

  it("a worker's own level above the alert's is said under the sign, and only then", async () => {
    act(() => {
      useProfile.getState().save(profile);
    });
    renderAlert(orangeFromTen);
    expect(await screen.findByText(whole("Your level is higher: Red"))).toBeInTheDocument();
  });

  it("says nothing about the worker's own level when it is not higher", async () => {
    act(() => {
      useProfile.getState().save({ ...profile, heatWorkStartDate: "2026-08-01" });
    });
    renderAlert(orangeFromTen);
    await screen.findByRole("heading", { name: "Orange" });
    expect(screen.queryByText(/Your level is higher/)).toBeNull();
  });

  it("a profile whose level cannot be worked out keeps the alert's level and says why", async () => {
    server.use(http.get("*/api/v1/risk-policy", () => HttpResponse.json({ type: "urn:x", title: "down", status: 500 }, { status: 500 })));
    act(() => {
      useProfile.getState().save(profile);
    });
    renderAlert(orangeFromTen);
    expect(await screen.findByText(/Your own level is not available right now/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Orange" })).toBeInTheDocument();
  });

  it("test_ended_alert_is_empty_state: a warning whose window is over says when it ended, with a way to Today", async () => {
    renderAlert(amberFromNine);

    expect(await screen.findByRole("heading", { name: "This warning ended at 10:00" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Today" })).toHaveAttribute("href", "/en/worker");
    expect(screen.queryByRole("heading", { name: "Amber" })).toBeNull();
    expect(document.querySelectorAll("[data-primary]")).toHaveLength(0);
  });

  describe("a forecast that cannot place the warning says nothing about whether the heat has ended (I1)", () => {
    /** The card keeps the warning's own level and the site rules, says why in a banner, and never claims the warning ended. */
    async function expectProtectiveCard(level: "Orange" | "Red") {
      expect(await screen.findByRole("heading", { name: level })).toBeInTheDocument();
      expect(screen.getByText("The latest forecast does not show this warning. This is the level the alert gave, saved on this phone.")).toBeInTheDocument();
      expect(screen.getByText("Follow the site rules")).toBeInTheDocument();
      expect(document.querySelector('[data-kind="stale"]')).not.toBeNull();
      expect(screen.queryByText(/This warning (has )?ended/)).toBeNull();
      // Nothing failed, so there is no error block and no retry for a problem that does not exist.
      expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
      expect(screen.getByRole("link", { name: "Got it" })).toHaveAttribute("href", "/en/worker");
    }

    function forecastWith(change: (forecast: Forecast) => Forecast) {
      const forecast = forecastToday(SITE_DEMO, { now: new Date("2026-09-03T07:10:00Z") });
      if (forecast === undefined) throw new Error("the fixture site has a forecast");
      server.use(http.get("*/api/v1/sites/:site_id/forecast/today", () => HttpResponse.json(change(forecast))));
    }

    it("another day (the notification's start is not in today's forecast)", async () => {
      renderAlert({ ...orangeFromTen, validFrom: "2026-09-01T06:00:00Z" });
      await expectProtectiveCard("Orange");
    });

    it("a start in the future that today's forecast does not reach", async () => {
      renderAlert({ ...orangeFromTen, level: "red", validFrom: "2026-09-04T06:00:00Z" });
      await expectProtectiveCard("Red");
    });

    it("a fallback forecast (no level for any hour)", async () => {
      forecastWith((forecast) => ({ ...forecast, forecast_status: "fallback", hours: forecast.hours.map((hour) => ({ ...hour, site_level: null })) }));
      renderAlert({ ...orangeFromTen, level: "red" });
      await expectProtectiveCard("Red");
    });

    it("an empty forecast (no hours)", async () => {
      forecastWith((forecast) => ({ ...forecast, hours: [] }));
      renderAlert(orangeFromTen);
      await expectProtectiveCard("Orange");
    });
  });

  it("with no forecast to read and the phone offline, the card still says the level the alert gave, saved on the phone", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    server.use(http.get("*/api/v1/sites/:site_id/forecast/today", () => HttpResponse.error()));
    renderAlert({ ...orangeFromTen, level: "red" });

    expect(await screen.findByRole("heading", { name: "Red" })).toBeInTheDocument();
    expect(screen.getByText("You are offline")).toBeInTheDocument();
    expect(screen.getByText("Follow the site rules")).toBeInTheDocument();
    expect(document.querySelector('[data-kind="stale"]')).not.toBeNull();
    expect(screen.getByRole("link", { name: "Got it" })).toHaveAttribute("href", "/en/worker");
  });

  it("with no forecast to read and the phone online, it says so and offers a retry, never a blank", async () => {
    server.use(
      http.get("*/api/v1/sites/:site_id/forecast/today", () =>
        HttpResponse.json(
          { type: "urn:stellar-blaze:problem:internal", title: "Internal", status: 500, request_id: "req-9" },
          { status: 500, headers: { "content-type": "application/problem+json" } },
        ),
      ),
    );
    renderAlert(orangeFromTen);

    expect(await screen.findByText("req-9")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
    expect(screen.getByRole("heading", { name: "Orange" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Got it" })).toBeInTheDocument();
  });

  it("is a skeleton at the final size until the forecast arrives", () => {
    const { container } = renderAlert(orangeFromTen);
    expect(container.querySelector('[aria-busy="true"] [data-skeleton]')).not.toBeNull();
  });
});
