import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import HsePage from "@/app/[locale]/(hse)/hse/page";
import { HseView } from "@/app/[locale]/(hse)/hse/HseView";
import { DemoProvider } from "@/features/demo/DemoProvider";
import { apiClient } from "@/api/client";
import { listCrews, resetDemoStateHard, SITE_DEMO } from "@/mocks/fixtures";
import { server } from "@/mocks/node";
import en from "../../../messages/en.json";

/*
 * The safety view's body (redesign S7): one row per crew of the demo site with its plan and whether work is stopped, the privacy sentence, the
 * boundary panel with its link to the refusal, and the demo controls out of the way. All four states, with the actionable empty state. It
 * reads the crews list the supervisor's screen reads (the mock API's answer here), and nothing about any one worker.
 */

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/en/hse",
}));
vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/en/hse",
  useRouter: () => ({ replace: vi.fn() }),
  Link: ({ href, children, prefetch, ...props }: { href: string; children: ReactNode; prefetch?: boolean; className?: string }) => (
    <a href={`/en${href}`} data-prefetch={String(prefetch)} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const messages = (await import("../../../messages/en.json")).default;
  return { getTranslations: (namespace: string) => Promise.resolve(createTranslator({ locale: "en", messages, namespace } as never)) };
});

const bff = {
  onRequest({ request }: { request: Request }) {
    request.headers.set("authorization", "Bearer demo-token");
    return request;
  },
};

beforeEach(() => {
  resetDemoStateHard();
  window.localStorage.clear();
  apiClient.use(bff);
});
afterEach(() => {
  apiClient.eject(bff);
});

function renderWith(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Dubai">
      <QueryClientProvider client={client}>
        <DemoProvider>{ui}</DemoProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

/** The crews table and its states alone. */
function renderView() {
  return renderWith(<HseView />);
}

/** The whole page: its server markup (title, privacy, boundary, notices) and the two client parts. */
async function renderPage() {
  return renderWith(await HsePage());
}

const rows = () => [...document.querySelectorAll<HTMLElement>("[data-crew]")];

describe("HseView: data", () => {
  it("lists every crew with its plan status and whether it is stopped, from the crews the API returns", async () => {
    renderView();

    const table = await screen.findByRole("table", { name: en.hse.table.caption });
    const crews = listCrews(SITE_DEMO) ?? [];
    expect(crews.length).toBeGreaterThan(0);
    expect(rows().map((row) => row.dataset["crew"])).toEqual(crews.map((crew) => crew.id));
    for (const crew of crews) {
      const row = within(table).getByText(crew.name).closest("tr");
      expect(row).not.toBeNull();
      const expectedPlan = crew.signoff_state === "signed" ? en.hse.plan.signed : crew.signoff_state === "unsigned" ? en.hse.plan.unsigned : en.hse.plan.changed;
      expect(row).toHaveTextContent(expectedPlan);
      expect(row).toHaveTextContent(crew.stopped ? en.hse.work.stopped : en.hse.work.running);
      expect(row).toHaveAttribute("data-stopped", String(crew.stopped));
    }
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([en.hse.table.crew, en.hse.table.plan, en.hse.table.work]);
  });

  it("shows a stopped crew as stopped and a crew whose plan changed after it was signed as changed", async () => {
    const base = listCrews(SITE_DEMO) ?? [];
    const [first, second, ...rest] = base;
    if (first === undefined || second === undefined) throw new Error("the fixture has fewer than two crews");
    server.use(
      http.get("*/api/v1/sites/:site_id/crews", () =>
        HttpResponse.json([
          { ...first, stopped: true, active_stop_id: "stop-1", stopped_at: "2026-09-03T08:00:00Z", signoff_state: "signed" },
          { ...second, signoff_state: "changed_since_signed" },
          ...rest,
        ]),
      ),
    );
    renderView();
    await screen.findByRole("table");
    const stopped = rows().find((row) => row.dataset["crew"] === first.id);
    expect(stopped).toHaveTextContent(en.hse.work.stopped);
    expect(stopped).toHaveTextContent(en.hse.plan.signed);
    expect(rows().find((row) => row.dataset["crew"] === second.id)).toHaveTextContent(en.hse.plan.changed);
  });

  it("says the privacy sentence and states the boundary, with a link to the refusal on the governance page", async () => {
    await renderPage();
    await screen.findByRole("table");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(en.hse.title);

    expect(document.querySelector("[data-privacy]")).toHaveTextContent("The service holds no individual worker health data.");
    const boundary = document.querySelector<HTMLElement>("[data-boundary]");
    expect(boundary).toHaveTextContent(en.hse.boundary.title);
    expect(boundary).toHaveTextContent("refused and logged");
    expect(within(boundary as HTMLElement).getByRole("link", { name: en.hse.boundary.link })).toHaveAttribute("href", "/en/replay/governance");
  });

  it("holds the demo controls (Replay or Live, Reset) in a closed section, not in the primary chrome", async () => {
    await renderPage();
    await screen.findByRole("table");

    const controls = document.querySelector<HTMLDetailsElement>("details[data-demo-controls]");
    expect(controls).not.toBeNull();
    expect(controls?.open).toBe(false);
    expect(within(controls as HTMLElement).getByText(en.hse.demo.title)).toBeInTheDocument();
    // Their code is not even loaded until the section is opened (the route budget): nothing of them is in the page before.
    expect(screen.queryByRole("button", { name: en.shell.demo.reset.button })).toBeNull();
    await userEvent.setup().click(within(controls as HTMLElement).getByText(en.hse.demo.title));
    // Both controls live inside the section; the page has no other.
    expect(await within(controls as HTMLElement).findByRole("button", { name: en.shell.demo.reset.button })).toBeInTheDocument();
    expect(within(controls as HTMLElement).getByRole("button", { name: en.shell.demo.mode.replay })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: en.shell.demo.reset.button })).toHaveLength(1);
  });

  it("holds no figure about any one worker: no head count, no name, no digit in the row text beyond the crew's own name", async () => {
    renderView();
    const table = await screen.findByRole("table");
    const crews = listCrews(SITE_DEMO) ?? [];
    let text = table.textContent;
    for (const crew of crews) text = text.replace(crew.name, "").replace(crew.task_label, "");
    expect(text).not.toMatch(/\d/);
  });
});

describe("HseView: loading, error, empty", () => {
  it("loading: a skeleton at a fixed height, the privacy sentence and the boundary already there", async () => {
    const { container } = await renderPage();
    expect(container.querySelector('[aria-busy="true"] [data-skeleton]')).not.toBeNull();
    expect(document.querySelector("[data-privacy]")).not.toBeNull();
    expect(document.querySelector("[data-boundary]")).not.toBeNull();
  });

  it("error: says what failed with its request id, offers a retry, and the retry loads the crews", async () => {
    let fail = true;
    server.use(
      http.get("*/api/v1/sites/:site_id/crews", () =>
        fail
          ? HttpResponse.json(
              { type: "urn:stellar-blaze:problem:dependency-unavailable", title: "Service unavailable", status: 503, request_id: "req-503" },
              { status: 503, headers: { "content-type": "application/problem+json" } },
            )
          : HttpResponse.json(listCrews(SITE_DEMO) ?? []),
      ),
    );
    renderView();

    expect(await screen.findByText(en.hse.error.title)).toBeInTheDocument();
    expect(screen.getByText("req-503")).toBeInTheDocument();
    fail = false;
    await userEvent.setup().click(screen.getByRole("button", { name: en.states.retry }));
    expect(await screen.findByRole("table")).toBeInTheDocument();
  });

  it("empty: no crews is an actionable state with a link that goes somewhere that exists", async () => {
    server.use(http.get("*/api/v1/sites/:site_id/crews", () => HttpResponse.json([])));
    renderView();

    expect(await screen.findByText(en.hse.empty.title)).toBeInTheDocument();
    expect(screen.getByText(en.hse.empty.reason)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: en.hse.empty.primary })).toHaveAttribute("href", "/en/start");
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("empty: no demo site at all is the same actionable empty state, not a spinner", async () => {
    server.use(http.get("*/api/v1/sites", () => HttpResponse.json([])));
    renderView();
    expect(await screen.findByText(en.hse.empty.title)).toBeInTheDocument();
  });
});
