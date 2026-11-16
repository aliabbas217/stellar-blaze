import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { useState, type ReactNode } from "react";
import enMessages from "../../../messages/en.json";
import { DeskShell } from "@/components/shell/DeskShell";
import { useFieldCrewLabel } from "@/components/shell/FieldHeading";
import { FieldShell } from "@/components/shell/FieldShell";
import { THEME_COLORS } from "@/lib/sun/theme-colors";
import { THEME_STORAGE_KEY } from "@/lib/sun/theme-storage";
import { renderWithIntl } from "../../utils/intl";

/*
 * The two shells are presentational compositions: they take what to show as props and import no feature. What they own
 * is the theme on a client navigation (the inline script does not re-run): the field shell applies sun mode, the desk
 * shell is night only, whichever route the visitor came from.
 */

let pathname = "/en/worker";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("@/i18n/navigation", () => ({
  usePathname: () => pathname.replace(/^\/[a-z]{2}/, "") || "/",
  getPathname: ({ href, locale }: { href: string; locale: string }) => `/${locale}${href}`,
  Link: ({ href, children, ...props }: { href: string; children: ReactNode; transitionTypes?: string[]; prefetch?: boolean }) => (
    // transitionTypes and prefetch are for the router, not the DOM.
    <a href={`/en${href}`} data-prefetch={String(props.prefetch)} {...Object.fromEntries(Object.entries(props).filter(([key]) => key !== "transitionTypes" && key !== "prefetch"))}>
      {children}
    </a>
  ),
}));

function chrome(): HTMLMetaElement {
  const meta = document.createElement("meta");
  meta.name = "theme-color";
  meta.content = THEME_COLORS.night;
  document.head.append(meta);
  return meta;
}

afterEach(() => {
  pathname = "/en/worker";
  window.localStorage.clear();
  delete document.documentElement.dataset["theme"];
  document.head.querySelectorAll("meta[name=theme-color]").forEach((meta) => {
    meta.remove();
  });
});

describe("FieldShell", () => {
  const props = { siteName: "Mussafah M-14 yard (synthetic)", crewLabel: "Crew B", clock: "11:10" } as const;

  it("header: site and crew, the clock in a bdi, the sun toggle and six language chips", () => {
    chrome();
    renderWithIntl(
      <FieldShell {...props} dock={<p>dock slot</p>}>
        <main>page</main>
      </FieldShell>,
    );
    const header = screen.getByRole("banner");
    expect(within(header).getByText("Mussafah M-14 yard (synthetic)")).toBeInTheDocument();
    expect(within(header).getByText("Crew B")).toBeInTheDocument();
    expect(within(header).getByText("11:10").tagName).toBe("BDI");
    expect(within(header).getByRole("button", { name: /Sun mode/ })).toBeInTheDocument();
    expect(within(screen.getByRole("navigation", { name: "Language" })).getAllByRole("link")).toHaveLength(6);
  });

  it("test_header_name_is_never_clamped: the demo site's '(synthetic)' marker is not cut by a line clamp (fix round 1; the real layout is asserted in rtl.spec.ts)", () => {
    chrome();
    renderWithIntl(
      <FieldShell {...props}>
        <main>page</main>
      </FieldShell>,
    );
    const name = within(screen.getByRole("banner")).getByText("Mussafah M-14 yard (synthetic)").closest("p");
    expect(name).not.toBeNull();
    expect(name?.className).not.toMatch(/line-clamp|truncate|overflow-hidden|text-ellipsis/);
    expect(name?.getAttribute("title")).toBe("Mussafah M-14 yard (synthetic)");
  });

  it("renders the page and the dock, and owns no <main> of its own", () => {
    chrome();
    const { container } = renderWithIntl(
      <FieldShell {...props} dock={<p>dock slot</p>}>
        <main>page</main>
      </FieldShell>,
    );
    expect(screen.getByText("page")).toBeInTheDocument();
    expect(screen.getByText("dock slot")).toBeInTheDocument();
    expect(container.querySelectorAll("main")).toHaveLength(1);
  });

  it("shows an honest line when no site is known", () => {
    chrome();
    renderWithIntl(
      <FieldShell siteName={null} crewLabel={null} clock="--:--">
        <main>page</main>
      </FieldShell>,
    );
    expect(screen.getByRole("banner")).toHaveTextContent("No site chosen");
  });

  it("test_field_shell_applies_sun_on_a_client_navigation_from_a_desk_route, and the toggle says so", async () => {
    const meta = chrome();
    pathname = "/en/worker";
    renderWithIntl(
      <FieldShell {...props}>
        <main>page</main>
      </FieldShell>,
    );

    await waitFor(() => {
      expect(document.documentElement.dataset["theme"]).toBe("sun");
    });
    expect(meta.content).toBe(THEME_COLORS.sun);
    expect(screen.getByRole("button", { name: "Sun mode: on" })).toBeInTheDocument();
  });

  it("re-applies on every route change, keeping the visitor's override", async () => {
    chrome();
    let navigate: () => void = () => undefined;
    function Harness() {
      const [, force] = useState(0);
      navigate = () => {
        force((count) => count + 1);
      };
      return (
        <FieldShell {...props}>
          <main>page</main>
        </FieldShell>
      );
    }
    renderWithIntl(<Harness />);
    await waitFor(() => {
      expect(document.documentElement.dataset["theme"]).toBe("sun");
    });

    await userEvent.setup().click(screen.getByRole("button", { name: "Sun mode: on" }));
    expect(document.documentElement.dataset["theme"]).toBeUndefined();
    expect(JSON.parse(window.localStorage.getItem(THEME_STORAGE_KEY) ?? "null")).toMatchObject({ theme: "night" });

    pathname = "/en/worker/alerts";
    act(() => {
      navigate();
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Sun mode: off" })).toBeInTheDocument();
    });
    expect(document.documentElement.dataset["theme"]).toBeUndefined();
  });

  it("test_field_shell_puts_night_back_when_it_unmounts (a client link out of a field route, to a page with no shell)", async () => {
    const meta = chrome();
    const { unmount } = renderWithIntl(
      <FieldShell {...props}>
        <main>page</main>
      </FieldShell>,
    );
    await waitFor(() => {
      expect(document.documentElement.dataset["theme"]).toBe("sun");
    });

    unmount();

    expect(document.documentElement.dataset["theme"]).toBeUndefined();
    expect(meta.content).toBe(THEME_COLORS.night);
  });

  it("names the crew a page reports (useFieldCrewLabel) and drops it when the page goes", () => {
    chrome();
    function Page({ label }: { label: string | null }) {
      useFieldCrewLabel(label);
      return <main>page</main>;
    }
    function Harness({ show }: { show: boolean }) {
      return (
        <FieldShell siteName="Site" clock="11:10">
          {show ? <Page label="Crew B" /> : <main>other</main>}
        </FieldShell>
      );
    }
    const { rerender } = renderWithIntl(<Harness show />);
    expect(within(screen.getByRole("banner")).getByText("Crew B").tagName).toBe("BDI");

    rerender(
      <NextIntlClientProvider locale="en" messages={enMessages} timeZone="Asia/Dubai">
        <Harness show={false} />
      </NextIntlClientProvider>,
    );
    expect(within(screen.getByRole("banner")).queryByText("Crew B")).toBeNull();
  });

  it("the layout's crewLabel wins over a page's", () => {
    chrome();
    function Page() {
      useFieldCrewLabel("From the page");
      return <main>page</main>;
    }
    renderWithIntl(
      <FieldShell siteName="Site" crewLabel="From the layout" clock="11:10">
        <Page />
      </FieldShell>,
    );
    const header = screen.getByRole("banner");
    expect(within(header).getByText("From the layout")).toBeInTheDocument();
    expect(within(header).queryByText("From the page")).toBeNull();
  });
});

describe("DeskShell", () => {
  const items = [
    { href: "/replay", label: "Scoreboard" },
    { href: "/replay/day", label: "One day" },
  ];

  it("no header link prefetches: a prefetched route's script would count against this page's JS budget", () => {
    pathname = "/en/replay";
    chrome();
    renderWithIntl(
      <DeskShell items={items}>
        <main>page</main>
      </DeskShell>,
    );
    const links = within(screen.getByRole("banner")).getAllByRole("link");
    expect(links).toHaveLength(items.length + 1);
    for (const link of links) expect(link).toHaveAttribute("data-prefetch", "false");
  });

  it("header: the wordmark and a menu of links, with the current page marked", () => {
    pathname = "/en/replay/day";
    chrome();
    renderWithIntl(
      <DeskShell items={items}>
        <main>page</main>
      </DeskShell>,
    );
    const header = screen.getByRole("banner");
    expect(within(header).getByRole("link", { name: "Stellar Blaze" })).toBeInTheDocument();
    const menu = within(header).getByRole("navigation", { name: "Main" });
    expect(within(menu).getByRole("link", { name: "One day" })).toHaveAttribute("aria-current", "page");
    expect(within(menu).getByRole("link", { name: "Scoreboard" })).not.toHaveAttribute("aria-current");
  });

  it("test_desk_shell_is_night_only: it removes sun mode left by a field route (client navigation, field to desk)", async () => {
    pathname = "/en/replay";
    const meta = chrome();
    document.documentElement.dataset["theme"] = "sun";
    meta.content = THEME_COLORS.sun;

    renderWithIntl(
      <DeskShell items={items}>
        <main>page</main>
      </DeskShell>,
    );

    await waitFor(() => {
      expect(document.documentElement.dataset["theme"]).toBeUndefined();
    });
    expect(meta.content).toBe(THEME_COLORS.night);
  });

  it("stays night even when a stored sun override exists", async () => {
    pathname = "/en/replay";
    chrome();
    window.localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify({ theme: "sun", until: Date.now() + 60_000 }));
    document.documentElement.dataset["theme"] = "sun";

    renderWithIntl(
      <DeskShell items={items}>
        <main>page</main>
      </DeskShell>,
    );

    await waitFor(() => {
      expect(document.documentElement.dataset["theme"]).toBeUndefined();
    });
  });

  it("renders the demo switch slot in the header when given", () => {
    chrome();
    renderWithIntl(
      <DeskShell items={items} trailing={<p>switch slot</p>}>
        <main>page</main>
      </DeskShell>,
    );
    expect(within(screen.getByRole("banner")).getByText("switch slot")).toBeInTheDocument();
  });
});
