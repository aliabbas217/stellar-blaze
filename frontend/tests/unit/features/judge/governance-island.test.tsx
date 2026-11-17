import { readFileSync } from "node:fs";
import path from "node:path";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { REFUSED_TYPE } from "@/features/judge/governance/answer";
import { GovernanceGate } from "@/features/judge/governance/GovernanceGate";
import { GovernanceStatic } from "@/features/judge/governance/GovernanceStatic";
import { parseRecordedRun, toRecordedView } from "@/features/judge/governance/recorded";
import { appendRefusal } from "@/mocks/fixtures";
import { server } from "@/mocks/node";
import { renderWithIntl } from "../../../utils/intl";

/*
 * The lazy island of /replay/governance (Part G2.1): the first paint is the server-rendered recorded run with plain controls and
 * NO API call; focus or pointerdown on a control only WARMS the chunk (the DOM, and a pressed button, are never replaced under a
 * press: Part G3 C1); the first click swaps the island in and performs that one send; taps made while it loads run in order; the
 * page never sends by itself.
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
const recorded = toRecordedView(parseRecordedRun(JSON.parse(readFileSync(path.join(root, "data/recorded/governance-run.json"), "utf8")) as unknown));
const SEND = "Send the employer's request";
const BANNER_SITE = "Mussafah M-14 yard (synthetic)";

function counting() {
  const calls = { posts: 0, gets: 0 };
  server.use(
    http.post("*/api/v1/sites/:site_id/data-requests", ({ params }) => {
      calls.posts += 1;
      appendRefusal(String(params.site_id));
      return new HttpResponse(JSON.stringify({ type: REFUSED_TYPE, title: "Individual data refused", status: 403, request_id: "island-1" }), {
        status: 403,
        headers: { "content-type": "application/problem+json" },
      });
    }),
    http.get("*/api/v1/*", () => {
      calls.gets += 1;
      return undefined;
    }),
  );
  return calls;
}

function renderGate() {
  return renderWithIntl(
    <GovernanceGate recorded={recorded}>
      <GovernanceStatic recorded={recorded} />
    </GovernanceGate>,
  );
}

describe("GovernanceGate: the lazy island", () => {
  it("first paint has the send, reset and mode controls as plain buttons, and calls no API", async () => {
    const calls = counting();
    const { container } = renderGate();
    expect(screen.getByRole("button", { name: SEND })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset demo site" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Replay" })).toHaveAttribute("aria-pressed", "true");
    expect(container.querySelector("[data-governance]")?.getAttribute("data-governance")).toBe("recorded");
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(calls).toEqual({ posts: 0, gets: 0 });
  });

  it("test_focus_alone_never_swaps_the_dom: focus warms the chunk, the page stays static, nothing is sent or fetched", async () => {
    const calls = counting();
    renderGate();
    const send = screen.getByRole("button", { name: SEND });
    send.focus();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(screen.getByRole("button", { name: SEND })).toBe(send);
    expect(send.isConnected).toBe(true);
    expect(document.activeElement).toBe(send);
    expect(screen.queryByText(BANNER_SITE)).toBeNull();
    expect(calls).toEqual({ posts: 0, gets: 0 });
  });

  it("test_pointerdown_then_swap_click_on_old_node_sends_once: the chunk resolves between pointerdown and click, the press survives", async () => {
    const calls = counting();
    const { container } = renderGate();
    const send = screen.getByRole("button", { name: SEND });
    fireEvent.pointerDown(send);
    // the chunk is there (a fast or cached chunk resolves inside a 60 to 150 ms press): the static page must still be the old nodes
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(send.isConnected).toBe(true);
    expect(calls).toEqual({ posts: 0, gets: 0 });
    fireEvent.click(send);
    await waitFor(() => {
      expect(container.querySelector("[data-governance]")?.getAttribute("data-governance")).toBe("live");
    });
    expect(calls.posts).toBe(1);
  });

  it("a second control tapped while the island loads is not lost: Reset then Send both run, once each", async () => {
    const calls = counting();
    let resets = 0;
    server.use(
      http.post("*/api/v1/sites/:site_id/demo-reset", () => {
        resets += 1;
        return HttpResponse.json({ epoch_id: 2 });
      }),
    );
    const { container } = renderGate();
    // both clicks land in the same tick, before the chunk can resolve
    fireEvent.click(screen.getByRole("button", { name: "Reset demo site" }));
    fireEvent.click(screen.getByRole("button", { name: SEND }));
    await waitFor(() => {
      expect(container.querySelector("[data-governance]")?.getAttribute("data-governance")).toBe("live");
    });
    expect(await screen.findByText(/Demo site reset \(new epoch/)).toBeInTheDocument();
    expect(resets).toBe(1);
    expect(calls.posts).toBe(1);
  });

  it("the first click loads the island and performs that one send (one POST, the 403, the new row)", async () => {
    const calls = counting();
    const { container } = renderGate();
    await userEvent.setup().click(screen.getByRole("button", { name: SEND }));
    await waitFor(() => {
      expect(container.querySelector("[data-governance]")?.getAttribute("data-governance")).toBe("live");
    });
    expect(calls.posts).toBe(1);
    expect(screen.getByRole("button", { name: "Send again" })).toBeInTheDocument();
  });

  it("the first click on Reset performs the reset once the site is known, and does not send", async () => {
    const calls = counting();
    let resets = 0;
    server.use(
      http.post("*/api/v1/sites/:site_id/demo-reset", () => {
        resets += 1;
        return HttpResponse.json({ epoch_id: 2 });
      }),
    );
    renderGate();
    await userEvent.setup().click(screen.getByRole("button", { name: "Reset demo site" }));
    expect(await screen.findByText(/Demo site reset \(new epoch/)).toBeInTheDocument();
    expect(resets).toBe(1);
    expect(calls.posts).toBe(0);
  });
});
