import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { RenderResult } from "@testing-library/react";
import type { Middleware } from "openapi-fetch";
import type { ReactNode } from "react";
import { apiClient } from "@/api/client";
import { DemoProvider } from "@/features/demo/DemoProvider";
import { CrewsView } from "@/features/supervisor/CrewsView";
import { PlanView } from "@/features/supervisor/plan/PlanView";
import { resetDemoStateHard } from "@/mocks/fixtures";
import { server } from "@/mocks/node";
import { renderWithIntl } from "../../../utils/intl";

/*
 * What the supervisor screen's tests share: the page's providers, the stand-in for the BFF (the employer routes need a bearer
 * token the BFF adds; here a client middleware does), and fresh mock state for every test. The two vi.mock calls that every one
 * of these files needs (next/navigation and the locale Link) cannot live here: Vitest hoists them per test file.
 */

const bff: Middleware = {
  onRequest({ request }) {
    request.headers.set("authorization", "Bearer demo-token");
    return request;
  },
};

/** What `apiClient.GET` threw in the current test, with when: `call()` turns every exception into "Network error" and keeps none of it. */
const thrownByGet: string[] = [];
/** What the mock server saw in the current test (its life-cycle events, with when), to tell "answered", "not matched" and "never seen". */
const mockServerLog: string[] = [];
const MOCK_SERVER_EVENTS = ["request:start", "request:match", "request:unhandled", "request:end", "response:mocked", "response:bypass"] as const;
let listeners: [string, (event: unknown) => void][] = [];
let fetchAtStart: typeof fetch | undefined;

function nowMs(): string {
  return `${String(Math.round(performance.now()))} ms`;
}

function recordWhatGetThrows(): void {
  thrownByGet.length = 0;
  fetchAtStart = globalThis.fetch;
  const original = apiClient.GET.bind(apiClient) as unknown as (...args: unknown[]) => Promise<unknown>;
  vi.spyOn(apiClient, "GET").mockImplementation(((...args: unknown[]) =>
    original(...args).catch((error: unknown) => {
      const what = error instanceof Error ? `${error.name}: ${error.message}; cause: ${String(error.cause)}\n${error.stack ?? ""}` : String(error);
      const fetchNow = globalThis.fetch === fetchAtStart ? "the same fetch as at the start of the test" : "NOT the fetch of the start of the test";
      thrownByGet.push(`${String(args[0])} threw at ${nowMs()} (${fetchNow}): ${what}`);
      throw error;
    })) as never);
}

function recordWhatTheMockServerSees(): void {
  mockServerLog.length = 0;
  listeners = MOCK_SERVER_EVENTS.map((name) => {
    const listener = (event: unknown): void => {
      const request = (event as { request?: Request }).request;
      mockServerLog.push(`${nowMs()} ${name} ${request === undefined ? "" : `${request.method} ${new URL(request.url).pathname}`}`);
    };
    server.events.on(name, listener);
    return [name, listener];
  });
}

/**
 * Starts recording what `apiClient.GET` throws and what the mock server sees, for the rest of the CURRENT test (both are undone after
 * it). Opt-in on purpose: wrapping every GET adds microtask hops and listeners that made a timing-bound Stop work focus test fail
 * one run in three, so only the test that is being investigated pays for it. Call it before `renderPlan`: the failing request is
 * the first one.
 */
export function recordDiagnostics(): void {
  recordWhatGetThrows();
  recordWhatTheMockServerSees();
}

function stopRecordingTheMockServer(): void {
  for (const [name, listener] of listeners) server.events.removeListener(name as (typeof MOCK_SERVER_EVENTS)[number], listener);
  listeners = [];
}

export function installSupervisorTestEnvironment(): void {
  beforeEach(() => {
    resetDemoStateHard();
    window.localStorage.clear();
    apiClient.use(bff);
  });
  afterEach(() => {
    apiClient.eject(bff);
    stopRecordingTheMockServer();
    vi.restoreAllMocks();
  });
}

export function renderCrews(): RenderResult {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const view: ReactNode = (
    <QueryClientProvider client={client}>
      <DemoProvider>
        <CrewsView />
      </DemoProvider>
    </QueryClientProvider>
  );
  return renderWithIntl(view);
}

/** The client of the latest renderPlan, kept only so that a failing wait can say what its queries were doing. */
let lastPlanClient: QueryClient | null = null;

/**
 * What every query of the latest renderPlan is doing: its key, status, fetch status and error. A `waitFor` that times out prints
 * the page, which shows THAT something is missing but not WHY (a request that never answered, one that failed, or one that was
 * never enabled look the same); this shows which.
 */
export function describeQueries(): string {
  if (lastPlanClient === null) return "no plan has been rendered";
  const rows = lastPlanClient.getQueryCache().getAll().map((query) => ({
    key: query.queryKey,
    status: query.state.status,
    fetchStatus: query.state.fetchStatus,
    error: query.state.error === null ? null : String(query.state.error),
  }));
  const seenByTheMockServer = mockServerLog.length === 0 ? "nothing" : `\n${mockServerLog.join("\n")}`;
  return [
    JSON.stringify(rows),
    `what apiClient.GET threw in this test: ${thrownByGet.length === 0 ? "nothing" : thrownByGet.join("\n---\n")}`,
    `what the mock server saw in this test (${nowMs()} now): ${seenByTheMockServer}`,
  ].join("\n");
}

export function renderPlan(crewId: string): RenderResult {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  lastPlanClient = client;
  const view: ReactNode = (
    <QueryClientProvider client={client}>
      <DemoProvider>
        <PlanView crewId={crewId} />
      </DemoProvider>
    </QueryClientProvider>
  );
  return renderWithIntl(view);
}

/** The text a screen reader would read, whitespace collapsed. */
export function textOf(element: Element | null): string {
  return (element?.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** The Stop work bar and the text in it. */
export function stopBar(): HTMLElement {
  const bar = document.querySelector<HTMLElement>("[data-emergency]");
  if (bar === null) throw new Error("the Stop work bar is not rendered");
  return bar;
}
