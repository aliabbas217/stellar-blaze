import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { RenderResult } from "@testing-library/react";
import type { Middleware } from "openapi-fetch";
import type { ReactNode } from "react";
import { apiClient } from "@/api/client";
import { DemoProvider } from "@/features/demo/DemoProvider";
import { CrewsView } from "@/features/supervisor/CrewsView";
import { resetDemoStateHard } from "@/mocks/fixtures";
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

export function installSupervisorTestEnvironment(): void {
  beforeEach(() => {
    resetDemoStateHard();
    window.localStorage.clear();
    apiClient.use(bff);
  });
  afterEach(() => {
    apiClient.eject(bff);
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
