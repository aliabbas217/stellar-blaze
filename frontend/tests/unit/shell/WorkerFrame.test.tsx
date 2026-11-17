import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { WorkerFrame } from "@/app/[locale]/(worker)/worker/(app)/WorkerFrame";
import { DemoProvider } from "@/features/demo/DemoProvider";
import { resetSitePinForTests } from "@/features/profile/site-pin";
import { useProfile } from "@/features/profile/store";
import { SITE_DEMO } from "@/mocks/fixtures";
import { installDialogPolyfill } from "../../utils/dialog-polyfill";
import { renderWithIntl } from "../../utils/intl";

/*
 * "Change crew" in the worker app's settings sheet (redesign S6a): it opens the join page, where the worker finds the site and the crew,
 * and it lets go of the old pin as the page leaves (so Today does not re-pin a stale `?site=` while the worker chooses another).
 */

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/en/worker",
}));
vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/worker",
  useRouter: () => ({ replace: vi.fn() }),
  getPathname: ({ href, locale }: { href: string; locale: string }) => `/${locale}${href}`,
  Link: ({ href, children, ...props }: { href: string; children: ReactNode; prefetch?: boolean; transitionTypes?: string[] }) => (
    // prefetch and transitionTypes are for the router, not the DOM.
    <a href={`/en${href}`} {...Object.fromEntries(Object.entries(props).filter(([key]) => key !== "transitionTypes" && key !== "prefetch"))}>
      {children}
    </a>
  ),
}));

const assign = vi.fn<(url: string) => void>();

beforeAll(installDialogPolyfill);

beforeEach(() => {
  window.localStorage.clear();
  resetSitePinForTests();
  useProfile.setState({ site: null });
  vi.stubGlobal("location", { assign, search: "?site=site-demo-mussafah&crew=crew-b", hash: "", pathname: "/en/worker", href: "http://localhost/en/worker" });
});

afterEach(() => {
  vi.unstubAllGlobals();
  assign.mockReset();
});

function renderFrame() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithIntl(
    <QueryClientProvider client={client}>
      <DemoProvider>
        <WorkerFrame>
          <main>Today</main>
        </WorkerFrame>
      </DemoProvider>
    </QueryClientProvider>,
  );
}

describe("Change crew", () => {
  it("goes to the join page, not to the first-run screen", async () => {
    renderFrame();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Settings/ }));
    const link = within(await screen.findByRole("dialog", { name: "Settings" })).getByRole("link", { name: "Change crew" });
    expect(link).toHaveAttribute("href", "/en/worker/join");
  });

  it("lets go of the pin only as the page leaves, then opens the join page", async () => {
    act(() => {
      useProfile.getState().chooseSite({ siteId: SITE_DEMO, crewId: "crew-b" });
    });
    renderFrame();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Settings/ }));
    await user.click(within(await screen.findByRole("dialog", { name: "Settings" })).getByRole("link", { name: "Change crew" }));

    await waitFor(() => {
      expect(assign).toHaveBeenCalledTimes(1);
    });
    expect(assign.mock.calls[0]?.[0]).toMatch(/\/en\/worker\/join$/);
    // Still pinned until the page is actually leaving: dropped sooner, Today would pin the address's ?site= again at once.
    expect(useProfile.getState().site).toMatchObject({ siteId: SITE_DEMO, crewId: "crew-b" });
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(useProfile.getState().site).toBeNull();
  });
});
