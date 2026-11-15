import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { ResetDemoControl } from "@/components/shell/ResetDemoControl";
import { problemOnce } from "@/mocks/handlers";
import { server } from "@/mocks/node";
import { renderWithIntl } from "../../utils/intl";

/*
 * Reset demo site (ADR 0062, 0066): one tap, no confirm dialog (nothing is deleted: a new epoch starts), never on its own.
 */

const SITE = "site-demo-mussafah";
/** What reset_demo_site answers: the new epoch is `epoch_id`. */
const RESET = { site_id: SITE, epoch_id: 2, previous_epoch_id: 1, reset_at: "2026-09-03T07:10:00Z" };

function renderControl() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  renderWithIntl(
    <QueryClientProvider client={client}>
      <ResetDemoControl siteId={SITE} />
    </QueryClientProvider>,
  );
  return { invalidate };
}

describe("ResetDemoControl", () => {
  it("never fires by itself", async () => {
    const seen = vi.fn();
    server.use(
      http.post("*/api/v1/sites/:site_id/demo-reset", () => {
        seen();
        return HttpResponse.json(RESET);
      }),
    );
    renderControl();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(seen).not.toHaveBeenCalled();
  });

  it("one tap calls reset_demo_site with no confirm dialog, then says the new epoch and invalidates the queries", async () => {
    // The mock API wants the employer token the BFF adds; in a unit test there is no BFF, so the answer is stated here.
    server.use(http.post("*/api/v1/sites/:site_id/demo-reset", () => HttpResponse.json(RESET)));
    const { invalidate } = renderControl();
    await userEvent.setup().click(screen.getByRole("button", { name: "Reset demo site" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Demo site reset (new epoch 2).");
    });
    expect(invalidate).toHaveBeenCalled();
  });

  it.each([404, 501])("on %i it says reset is not available on this deployment", async (status) => {
    server.use(problemOnce(`/api/v1/sites/${SITE}/demo-reset`, status));
    renderControl();
    await userEvent.setup().click(screen.getByRole("button", { name: "Reset demo site" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Reset is not available on this deployment.");
    });
  });

  it("on 429 it says reset is limited to once a minute, calmly (a status, not an alert)", async () => {
    server.use(problemOnce(`/api/v1/sites/${SITE}/demo-reset`, 429));
    renderControl();
    await userEvent.setup().click(screen.getByRole("button", { name: "Reset demo site" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Reset is limited to once a minute. Try again shortly.");
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("on another failure it says it could not reset, with the request id", async () => {
    server.use(problemOnce(`/api/v1/sites/${SITE}/demo-reset`, 500));
    renderControl();
    await userEvent.setup().click(screen.getByRole("button", { name: "Reset demo site" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("We could not reset the demo site");
    });
    expect(screen.getByRole("alert")).toHaveTextContent("mock-req-1");
  });

  it("keeps its label while the request is in flight and is a target of 44 px or more", async () => {
    server.use(
      http.post("*/api/v1/sites/:site_id/demo-reset", async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return HttpResponse.json(RESET);
      }),
    );
    renderControl();
    const button = screen.getByRole("button", { name: "Reset demo site" });
    expect(button).toHaveClass("min-h-(--target)");
    await userEvent.setup().click(button);
    expect(screen.getByRole("button", { name: /Reset demo site/ })).toBeInTheDocument();
  });
});
