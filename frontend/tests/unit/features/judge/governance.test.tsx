import { readFileSync } from "node:fs";
import path from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse, delay } from "msw";
import type { ReactNode } from "react";
import { AccessLog } from "@/components/governance/AccessLog";
import { DemoProvider } from "@/features/demo/DemoProvider";
import { outcomeOf, REFUSED_TYPE, REQUEST_DATA_CLASS, SYNTHETIC_WORKER_REF } from "@/features/judge/governance/answer";
import { GovernanceView } from "@/features/judge/governance/GovernanceView";
import { parseRecordedRun, toRecordedView } from "@/features/judge/governance/recorded";
import type { RecordedView } from "@/features/judge/governance/recorded-view";
import { appendRefusal, resetDemoStateHard } from "@/mocks/fixtures";
import { server } from "@/mocks/node";
import { renderWithIntl } from "../../../utils/intl";

/*
 * The governance refusal (F2 Task 15): safety and governance work. What is pinned here: the recorded run is the first paint,
 * the page never sends by itself, a send is one real POST with the made-up reference and no purpose, the refusal and the
 * new log row appear, every other outcome (401, 429, unreachable, a 2xx) is told apart and never worded as a refusal, the
 * worker's list is site-level and never "about you", and the API's `rule` text and design-record references never reach the
 * screen.
 */

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/en/replay/governance",
}));
vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/en/replay/governance",
  useRouter: () => ({ replace: vi.fn() }),
  Link: ({ href, children, ...props }: { href: string; children: ReactNode; className?: string }) => (
    <a href={`/en${href}`} {...props}>
      {children}
    </a>
  ),
}));

const root = path.resolve(import.meta.dirname, "../../../..");
const recordedFile = JSON.parse(readFileSync(path.join(root, "data/recorded/governance-run.json"), "utf8")) as unknown;
const recorded: RecordedView = toRecordedView(parseRecordedRun(recordedFile));

const SENTENCE = "A request for a worker's health data was refused";
const SEND = "Send the employer's request";

const PROBLEM = {
  type: REFUSED_TYPE,
  title: "Individual data refused",
  status: 403,
  // The API's own detail text carries a design-record reference; it must never be printed.
  detail: "Individual health data is not held by this service and is never released to an employer (ADR 0004).",
  request_id: "live-req-7",
};

const problemResponse = (body: Record<string, unknown>) =>
  new HttpResponse(JSON.stringify(body), { status: Number(body.status), headers: { "content-type": "application/problem+json" } });

/** The employer endpoint as the BFF would reach it (the BFF adds the token; a unit test has none). Counts the calls. */
function refusing(calls: { bodies: unknown[] }) {
  return http.post("*/api/v1/sites/:site_id/data-requests", async ({ request, params }) => {
    calls.bodies.push(await request.json());
    appendRefusal(String(params.site_id));
    return problemResponse(PROBLEM);
  });
}

function renderView(run: RecordedView | null = recorded) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const view = renderWithIntl(
    <QueryClientProvider client={client}>
      <DemoProvider>
        <GovernanceView recorded={run} />
      </DemoProvider>
    </QueryClientProvider>,
  );
  return { ...view, root: () => view.container.querySelector("[data-governance]") as HTMLElement };
}

const rows = (container: HTMLElement) => container.querySelectorAll("[data-access-row]");

beforeEach(() => {
  resetDemoStateHard();
});

describe("GovernanceView: first paint", () => {
  it("test_first_paint_is_the_recorded_run: a completed run is on screen before any call, under RECORDED", () => {
    const { container, root: view } = renderView();
    expect(view().getAttribute("data-governance")).toBe("recorded");
    expect(container.querySelectorAll("[data-hero]")).toHaveLength(1);
    // the stamp, and a source-specific line: the recording was made against the mock API, never the live service
    expect(screen.getByText("Recorded")).toBeInTheDocument();
    expect(screen.queryByText("Simulated")).toBeNull();
    expect(container.querySelector("[data-notice=recorded]")?.textContent).toContain(
      "Recorded against the demo mock, not the live service. Press the button to run it against the demo API.",
    );
    expect(container.querySelector("[data-notice=recorded]")?.textContent).not.toMatch(/same audit row|same request/);
    // the answer: 403 and the problem fields
    expect(within(container.querySelector("[data-answer=shown]") as HTMLElement).getByText("403")).toBeInTheDocument();
    expect(screen.getByText(REFUSED_TYPE)).toBeInTheDocument();
    expect(screen.getByText("Individual data refused")).toBeInTheDocument();
    expect(screen.getByText(recorded.answer.requestId as string)).toBeInTheDocument();
    expect(screen.getByText("content-type: application/problem+json")).toBeInTheDocument();
    // the audit row and the worker's list, from the recorded log
    const audit = container.querySelector("[data-audit=shown]") as HTMLElement;
    expect(within(audit).getByText(/mock-0/)).toBeInTheDocument();
    expect(rows(container)).toHaveLength(recorded.entries.length);
    expect(screen.getByText(SENTENCE)).toBeInTheDocument();
  });

  it("puts a clock time on each of the four steps, in time order, in Dubai time with Western digits", () => {
    const { container } = renderView();
    const times = [...container.querySelectorAll("[data-step] b")].map((b) => b.textContent);
    expect(times).toHaveLength(4);
    for (const time of times) expect(time).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    expect([...times].sort()).toEqual(times);
    // 23:30:15 UTC on 14 Nov is 03:30:15 in Dubai (UTC+4)
    expect(times[0]).toBe("03:30:15");
  });

  it("test_page_never_auto_sends: nothing is POSTed on load, on site discovery or while it sits there", async () => {
    const calls = { bodies: [] as unknown[] };
    server.use(refusing(calls));
    renderView();
    await screen.findByText("Synthetic demo site: no real people, no real data");
    await screen.findByRole("button", { name: "Reset demo site" }); // the demo site has loaded
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(calls.bodies).toHaveLength(0);
  });

  it("test_no_purpose_control: there is no purpose to pick and the word never appears", () => {
    const { container } = renderView();
    expect(container.querySelector("select, [role=combobox], [role=listbox]")).toBeNull();
    expect(screen.queryByLabelText(/purpose/i)).toBeNull();
    expect(container.textContent).not.toMatch(/purpose/i);
  });

  it("test_copy_is_site_level_not_about_you: the worker's list says an employer asked at the site, never about the reader", () => {
    const { container } = renderView();
    const list = container.querySelector("[data-access-log=rows]") as HTMLElement;
    expect(list.textContent).toContain(SENTENCE);
    expect(container.textContent).not.toMatch(/about you|your (health )?data|you were asked/i);
    // and the sentence is the claim of the API's entry: it names no worker, no employer, no id
    expect(list.textContent).not.toMatch(/synthetic-example-worker|employer-/);
  });

  it("never prints the API's rule text, a design-record reference or ADR wording, and says tamper-evident, not tamper-proof", () => {
    const { container } = renderView();
    const text = container.textContent;
    expect(text).not.toMatch(/ADR|PDPL|purpose limitation|HANDOFF|\bB[123]\b/);
    expect(text).not.toMatch(/[–—]/);
    expect(text).toMatch(/tamper-evident/);
    expect(text).not.toMatch(/tamper-proof/i);
  });

  it("shows the three build tests that prove it in a collapsed details", () => {
    const { container } = renderView();
    const details = container.querySelector("details[data-proves]") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    for (const name of ["test_data_request_403_and_audit_row", "test_transparency_log_shows_refusal", "test_verify_detects_edited_row"]) {
      expect(within(details).getByText(name)).toBeInTheDocument();
    }
  });

  it("mounts the synthetic demo banner and the reset control once the demo site is known", async () => {
    renderView();
    expect(screen.getByText("Synthetic demo site: no real people, no real data")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Reset demo site" })).toBeInTheDocument();
    expect(await screen.findByText("Mussafah M-14 yard (synthetic)")).toBeInTheDocument();
  });

  it("a reset the API limits is a calm line, not an alert", async () => {
    server.use(http.post("*/api/v1/sites/:site_id/demo-reset", () => problemResponse({ type: "urn:stellar-blaze:problem:rate-limited", title: "Rate limited", status: 429 })));
    renderView();
    await userEvent.setup().click(await screen.findByRole("button", { name: "Reset demo site" }));
    await waitFor(() => {
      expect(screen.getByText("Reset is limited to once a minute. Try again shortly.")).toBeInTheDocument();
    });
  });
});

describe("GovernanceView: the live call", () => {
  it("test_send_again_posts_and_shows_403_and_new_log_row: one real POST, the 403 card, and a new row in the worker's list", async () => {
    const calls = { bodies: [] as unknown[] };
    server.use(refusing(calls));
    const { container, root: view } = renderView();
    const user = userEvent.setup();
    await screen.findByRole("button", { name: "Reset demo site" });

    await user.click(screen.getByRole("button", { name: SEND }));
    await waitFor(() => {
      expect(view().getAttribute("data-governance")).toBe("live");
    });
    // one POST with the made-up reference, health, and no purpose
    expect(calls.bodies).toEqual([{ subject: "worker", data_class: "health", worker_ref: SYNTHETIC_WORKER_REF }]);
    // the live answer: 403, the type, the request id the live call returned
    expect(within(container.querySelector("[data-answer=shown]") as HTMLElement).getByText("403")).toBeInTheDocument();
    expect(screen.getByText("live-req-7")).toBeInTheDocument();
    // the worker's list is the live log now: exactly the one row the call wrote (the recorded row is replaced, not stacked)
    expect(rows(container)).toHaveLength(1);
    expect(screen.queryByText("Recorded")).toBeNull();
    expect(screen.getByText("Live.")).toBeInTheDocument();
    // the button reads "Send again" now and a second send appends a second row
    await user.click(screen.getByRole("button", { name: "Send again" }));
    await waitFor(() => {
      expect(rows(container)).toHaveLength(2);
    });
    expect(calls.bodies).toHaveLength(2);
  });

  it("the data class shown on the request card is the one the body carries (one constant, shown as a label)", async () => {
    const calls = { bodies: [] as unknown[] };
    server.use(refusing(calls));
    const { container } = renderView();
    const card = container.querySelector("[data-step]:nth-child(1)") as HTMLElement;
    expect(within(card).getByText("Health")).toBeInTheDocument();
    expect(card.textContent).not.toMatch(/health/);
    await screen.findByRole("button", { name: "Reset demo site" });
    await userEvent.setup().click(screen.getByRole("button", { name: SEND }));
    await waitFor(() => {
      expect(calls.bodies).toHaveLength(1);
    });
    expect((calls.bodies[0] as { data_class: string }).data_class).toBe(REQUEST_DATA_CLASS);
    expect(REQUEST_DATA_CLASS).toBe("health");
  });

  it("every sentence derived from a log row is the architect's fixed copy: a request for a worker's health data was refused (G4 ruling, which replaces the 'individual data' wording)", () => {
    server.use(refusing({ bodies: [] }));
    const { container } = renderView();
    expect((container.querySelector("[data-access-log=rows]") as HTMLElement).textContent).toContain(SENTENCE);
    expect((container.querySelector("[data-audit=shown]") as HTMLElement).textContent).toContain("A worker's health data is never released to an employer");
    expect(document.body.textContent).not.toContain("An employer request for individual data");
  });

  it("keeps the button label and marks the call busy while it runs (the button was never pre-disabled)", async () => {
    server.use(
      http.post("*/api/v1/sites/:site_id/data-requests", async () => {
        await delay("infinite");
        return problemResponse(PROBLEM);
      }),
    );
    const { container, root: view } = renderView();
    const user = userEvent.setup();
    await screen.findByRole("button", { name: "Reset demo site" });
    const button = screen.getByRole("button", { name: SEND });
    expect(button).not.toBeDisabled();
    await user.click(button);
    await waitFor(() => {
      expect(view().getAttribute("data-governance")).toBe("loading");
    });
    const busy = screen.getByRole("button", { name: SEND });
    expect(busy).toHaveAttribute("aria-busy", "true");
    expect(container.querySelectorAll("[data-skeleton]").length).toBeGreaterThan(0);
    expect(screen.getByText("Waiting for the API")).toBeInTheDocument();
  });

  it("rows the API already has (an earlier send, maybe another visitor) sit in their own labelled block and never replace a recorded step", async () => {
    appendRefusal("site-demo-mussafah");
    appendRefusal("site-demo-mussafah");
    const { container, root: view } = renderView();
    const block = await waitFor(() => {
      const found = container.querySelector("[data-live-rows]");
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    expect(within(block).getByRole("heading", { name: "Live rows from the demo API" })).toBeInTheDocument();
    expect(rows(block)).toHaveLength(2);
    // step 4 is still the recorded run's own row: one story, one clock, every step labelled recorded
    const step4 = container.querySelector("[data-log-source]") as HTMLElement;
    expect(step4.getAttribute("data-log-source")).toBe("recorded");
    expect(rows(step4)).toHaveLength(recorded.entries.length);
    expect(view().getAttribute("data-governance")).toBe("recorded");
    expect(container.querySelector("[data-notice=live]")).toBeNull();
    expect(screen.getByText("03:30:15", { selector: "[data-step]:nth-child(2) b" })).toBeInTheDocument();
    const clocks = [...container.querySelectorAll("[data-step] b")].map((b) => b.textContent);
    expect(clocks.slice(2)).toEqual(["03:30:15", "03:30:15"]);
  });

  it("without any live row there is no live block (nothing to label)", async () => {
    const { container } = renderView();
    await screen.findByRole("button", { name: "Reset demo site" });
    await waitFor(() => {
      expect(container.querySelector("[data-log-source]")).not.toBeNull();
    });
    expect(container.querySelector("[data-live-rows]")).toBeNull();
  });

  it("caps the worker's list at the newest three rows and says how many there are", async () => {
    for (let i = 0; i < 7; i += 1) appendRefusal("site-demo-mussafah");
    const { container } = renderView();
    await waitFor(() => {
      expect(container.querySelector("[data-live-rows]")).not.toBeNull();
    });
    expect(rows(container.querySelector("[data-live-rows]") as HTMLElement)).toHaveLength(3);
    const block = container.querySelector("[data-live-rows]") as HTMLElement;
    expect(within(block).getByText("The newest 3 of 7 rows, from the demo API's log")).toBeInTheDocument();
  });

  it("a refusal whose log comes back empty says so (empty), never a row it does not have", async () => {
    server.use(
      refusing({ bodies: [] }),
      http.get("*/api/v1/sites/:site_id/transparency-log", ({ params }) => HttpResponse.json({ site_id: params.site_id, entries: [] })),
    );
    const { container, root: view } = renderView();
    const user = userEvent.setup();
    await screen.findByRole("button", { name: "Reset demo site" });
    await user.click(screen.getByRole("button", { name: SEND }));
    await waitFor(() => {
      expect(view().getAttribute("data-governance")).toBe("empty");
    });
    expect(rows(container)).toHaveLength(0);
    expect(screen.getByText("Nobody has asked for individual data at this site.")).toBeInTheDocument();
    expect(container.querySelector("[data-audit=none]")).not.toBeNull();
  });

  it("with no recorded run and nothing sent, the page says so and offers the live call", () => {
    const { container, root: view } = renderView(null);
    expect(view().getAttribute("data-governance")).toBe("empty");
    expect(container.querySelector("[data-notice=norun]")).not.toBeNull();
    expect(container.querySelector("[data-answer=none]")).not.toBeNull();
    expect(screen.getByRole("button", { name: SEND })).toBeInTheDocument();
  });
});

describe("GovernanceView: outcomes that are not a refusal", () => {
  async function sendWith(handler: ReturnType<typeof http.post>, run: RecordedView | null = recorded) {
    server.use(handler);
    const view = renderView(run);
    const user = userEvent.setup();
    await screen.findByRole("button", { name: "Reset demo site" });
    await user.click(screen.getByRole("button", { name: SEND }));
    return view;
  }

  it("401 (no demo token on this deployment): states it, keeps the recorded run, claims no refusal", async () => {
    const { container, root: view } = await sendWith(
      http.post("*/api/v1/sites/:site_id/data-requests", () => problemResponse({ type: "urn:stellar-blaze:problem:unauthorized", title: "Unauthorized", status: 401 })),
    );
    await waitFor(() => {
      expect(view().getAttribute("data-governance")).toBe("unauthorized");
    });
    const notice = container.querySelector("[data-notice=unauthorized]") as HTMLElement;
    expect(notice.getAttribute("role")).toBe("alert");
    expect(notice.textContent).toMatch(/no demo employer token/);
    expect(notice.textContent).toMatch(/Nothing was recorded/);
    expect(screen.queryByRole("button", { name: "Send again" })).toBeNull();
    // the recorded run stays, still labelled recorded; nothing live was drawn
    expect(screen.getByText("Recorded")).toBeInTheDocument();
    expect(container.querySelector("[data-notice=live]")).toBeNull();
    expect(container.textContent).not.toMatch(/ADR|PDPL/);
  });

  it("429: says 'Not sent. Try again in a minute.', never retries, and the page does not send again by itself", async () => {
    let calls = 0;
    const { container, root: view } = await sendWith(
      http.post("*/api/v1/sites/:site_id/data-requests", () => {
        calls += 1;
        return problemResponse({ type: "urn:stellar-blaze:problem:rate-limited", title: "Rate limited", status: 429 });
      }),
    );
    await waitFor(() => {
      expect(view().getAttribute("data-governance")).toBe("limited");
    });
    expect(screen.getByText("Not sent. Try again in a minute.")).toBeInTheDocument();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    expect(calls).toBe(1);
    // calm: a status line, not an alert
    expect(container.querySelector("[data-notice=limited]")?.getAttribute("role")).toBe("status");
    // and it can be sent again by hand; nothing was sent, so the button does not claim "again"
    expect(screen.queryByRole("button", { name: "Send again" })).toBeNull();
    expect(screen.getByRole("button", { name: SEND })).not.toBeDisabled();
  });

  it("API unreachable: the recorded run plus 'Nothing was sent, so nothing was recorded'", async () => {
    const { container, root: view } = await sendWith(http.post("*/api/v1/sites/:site_id/data-requests", () => HttpResponse.error()));
    await waitFor(() => {
      expect(view().getAttribute("data-governance")).toBe("failed");
    });
    const notice = container.querySelector("[data-notice=failed]") as HTMLElement;
    expect(notice.textContent).toContain("Nothing was sent, so nothing was recorded.");
    expect(screen.queryByRole("button", { name: "Send again" })).toBeNull();
    expect(screen.getByText("Recorded")).toBeInTheDocument();
    expect(container.querySelector("[data-answer=shown]")).not.toBeNull();
  });

  it("an upstream failure shows the request id, so someone can look it up", async () => {
    const { container, root: view } = await sendWith(
      http.post("*/api/v1/sites/:site_id/data-requests", () =>
        problemResponse({ type: "urn:stellar-blaze:problem:upstream-unavailable", title: "Upstream unavailable", status: 502, request_id: "req-e02b61d9" }),
      ),
    );
    await waitFor(() => {
      expect(view().getAttribute("data-governance")).toBe("failed");
    });
    expect(within(container.querySelector("[data-notice=failed]") as HTMLElement).getByText("req-e02b61d9")).toBeInTheDocument();
  });

  it("a 2xx is never reported as a result: the contract says every answer is a refusal", async () => {
    const { container, root: view } = await sendWith(http.post("*/api/v1/sites/:site_id/data-requests", () => HttpResponse.json({ ok: true }, { status: 200 })));
    await waitFor(() => {
      expect(view().getAttribute("data-governance")).toBe("unexpected");
    });
    expect(container.querySelector("[data-notice=unexpected]")?.textContent).toContain("The API did not refuse the request.");
    expect(container.querySelector("[data-notice=live]")).toBeNull();
  });

  it("a 403 of another problem type is not worded as a refusal of the request", () => {
    expect(outcomeOf({ type: "urn:stellar-blaze:problem:forbidden", title: "Forbidden", status: 403 }, "2026-11-15T00:00:00Z").kind).toBe("failed");
    expect(outcomeOf({ type: REFUSED_TYPE, title: "Individual data refused", status: 403, request_id: "r" }, "2026-11-15T00:00:00Z")).toMatchObject({
      kind: "refused",
      answer: { status: 403, requestId: "r" },
    });
    expect(outcomeOf({ type: "x", title: "x", status: 401 }, "t").kind).toBe("unauthorized");
    expect(outcomeOf({ type: "x", title: "x", status: 429 }, "t").kind).toBe("limited");
    expect(outcomeOf({ type: "x", title: "x", status: 0 }, "t").kind).toBe("failed");
  });
});

describe("AccessLog", () => {
  const entry = (at: string) => ({
    at,
    kind: "data_request.refused" as const,
    outcome: "refused" as const,
    actor_role: "employer" as const,
    rule: "ADR 0004; PDPL purpose limitation",
    policy_version: "p",
    config_version: 1,
    model_id: null,
  });

  it("draws one site-level row per entry, newest first as given, with the time in Dubai time", () => {
    const { container } = renderWithIntl(<AccessLog entries={[entry("2026-11-15T10:00:05Z"), entry("2026-11-15T09:00:00Z")]} empty={<p>none</p>} />);
    const list = container.querySelectorAll("[data-access-row]");
    expect(list).toHaveLength(2);
    expect(list[0]?.querySelector("time")?.getAttribute("datetime")).toBe("2026-11-15T10:00:05Z");
    expect(list[0]?.textContent).toContain("14:00:05");
    expect(list[1]?.textContent).toContain("13:00:00");
    expect(container.textContent).toContain(SENTENCE);
  });

  it("never prints the rule text or any member of the entry other than its time", () => {
    const { container } = renderWithIntl(<AccessLog entries={[entry("2026-11-15T10:00:05Z")]} empty={null} />);
    expect(container.textContent).not.toMatch(/ADR|PDPL|purpose|employer-|data_request|refused"|p · 1/);
  });

  it("shows the caller's empty node when there is no entry", () => {
    const { container } = renderWithIntl(<AccessLog entries={[]} empty={<p>Nobody has asked.</p>} />);
    expect(container.querySelector("[data-access-log=empty]")?.textContent).toBe("Nobody has asked.");
    expect(container.querySelectorAll("[data-access-row]")).toHaveLength(0);
  });

  it("test_access_log_is_shared_and_imports_no_feature: it lives in components/, takes props, and the screen uses that one", () => {
    const source = readFileSync(path.join(root, "src/components/governance/AccessLog.tsx"), "utf8");
    expect(source).not.toMatch(/from\s+["'](?:@\/features\/|(?:\.\.?\/)+features\/)/);
    expect(source).not.toMatch(/from\s+["']@\/(?:api\/(?:client|queries)|providers)/);
    const view = readFileSync(path.join(root, "src/features/judge/governance/GovernanceLayout.tsx"), "utf8");
    expect(view).toContain('from "@/components/governance/AccessLog"');
    expect(view).not.toMatch(/function AccessLog|const AccessLog/);
  });
});

describe("the recorded run file", () => {
  it("parses, is one refusal with its one row, and holds only the made-up worker reference", () => {
    const run = parseRecordedRun(recordedFile);
    expect(run.response.status).toBe(403);
    expect(run.response.body.type).toBe(REFUSED_TYPE);
    expect(run.log.entries).toHaveLength(1);
    expect(run.request.body.worker_ref).toBe(SYNTHETIC_WORKER_REF);
    expect(run.request.path).toBe(`/api/v1/sites/${run.site_id}/data-requests`);
  });

  it("reaches the client without the rule text or the API's detail (no ADR wording in the page payload)", () => {
    expect(JSON.stringify(recorded)).not.toMatch(/ADR|PDPL|purpose limitation|detail|rule/);
  });

  it("the recording script and the page agree on the made-up reference", () => {
    const script = readFileSync(path.join(root, "scripts/record-governance-run.mjs"), "utf8");
    expect(script).toContain(`const WORKER_REF = "${SYNTHETIC_WORKER_REF}";`);
  });
});
