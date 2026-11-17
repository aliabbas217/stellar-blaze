import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { RoleBadge } from "@/components/shell/RoleBadge";
import { RoleEntry } from "@/components/shell/RoleEntry";
import { clearDemoRole, readDemoRole, setDemoRole } from "@/lib/demo-role";
import en from "../../../messages/en.json";
import { renderWithIntl } from "../../utils/intl";

/*
 * The role entry and the role badge (redesign S7). The entry is not a sign-in: no field, no wait, the sentence that says so, one button that
 * remembers the demo role and goes to the role's screen. The badge is a label whose absence never blocks a screen.
 */

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, prefetch, onClick, ...props }: { href: string; children: ReactNode; prefetch?: boolean; onClick?: () => void; className?: string }) => (
    <a
      href={`/en${href}`}
      data-prefetch={String(prefetch)}
      onClick={(event) => {
        event.preventDefault();
        onClick?.();
      }}
      {...props}
    >
      {children}
    </a>
  ),
}));

const copy = en.judge.roleEntry;

function renderEntry(role: "crew-lead" | "officer") {
  const crew = role === "crew-lead";
  return renderWithIntl(
    <RoleEntry
      demoRole={role}
      href={crew ? "/supervisor" : "/hse"}
      title={crew ? copy.crew.title : copy.officer.title}
      sees={crew ? copy.crew.sees : copy.officer.sees}
      button={crew ? copy.crew.button : copy.officer.button}
      demoAccess={copy.demoAccess}
      production={copy.production}
      change={copy.change}
    />,
  );
}

afterEach(() => {
  clearDemoRole();
  window.sessionStorage.clear();
});

describe("RoleEntry", () => {
  it.each([
    ["crew-lead", "/en/supervisor", "Open the crews screen"],
    ["officer", "/en/hse", "Open the safety view"],
  ] as const)("%s: what the role sees, the demo-access sentence in plain sight, one primary button to the screen, and a way back", (role, href, label) => {
    const { container } = renderEntry(role);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(role === "crew-lead" ? "Crew lead, demo" : "Safety officer, demo");
    const access = container.querySelector("[data-demo-access]");
    expect(access).toHaveTextContent("Demo access. Anyone can enter.");
    // Plain sight, Tier 1: a full-size paragraph, not small print.
    expect(access?.className).toMatch(/text-base/);
    expect(access?.className).not.toMatch(/text-(xs|sm)\b/);
    expect(container).toHaveTextContent(copy.production);
    const primary = container.querySelectorAll("[data-primary]");
    expect(primary).toHaveLength(1);
    expect(primary[0]).toHaveTextContent(label);
    expect(primary[0]).toHaveAttribute("href", href);
    expect(screen.getByRole("link", { name: copy.change })).toHaveAttribute("href", "/en/start");
  });

  it("is not a sign-in: no field, no form, no password, no pending state", () => {
    const { container } = renderEntry("crew-lead");
    expect(container.querySelectorAll("input, textarea, select, form")).toHaveLength(0);
    expect(container.querySelector("[aria-busy]")).toBeNull();
    expect(container.textContent).not.toMatch(/password|e-?mail|sign in to your account/i);
  });

  it("names no vendor product for the production sign-in", () => {
    expect(copy.production).not.toMatch(/entra|microsoft|azure|okta|auth0|google/i);
  });

  it("the button remembers the demo role for the session and follows its link", async () => {
    renderEntry("officer");
    expect(readDemoRole()).toBeNull();
    await userEvent.setup().click(screen.getByRole("link", { name: copy.officer.button }));
    expect(readDemoRole()).toBe("officer");
    expect(window.sessionStorage.getItem("sb-demo-role")).toBe("officer");
    expect(document.cookie).toBe("");
  });
});

describe("RoleBadge", () => {
  it("says the demo role and offers Switch role, which forgets the role and goes to the front door", async () => {
    setDemoRole("crew-lead");
    renderWithIntl(<RoleBadge />);
    expect(screen.getByText("Demo: crew lead")).toBeInTheDocument();
    const switchRole = screen.getByRole("link", { name: "Switch role" });
    expect(switchRole).toHaveAttribute("href", "/en/start");
    await userEvent.setup().click(switchRole);
    expect(readDemoRole()).toBeNull();
    // The badge follows the change in the same tab.
    expect(screen.queryByText("Demo: crew lead")).toBeNull();
    expect(screen.getByRole("link", { name: "Choose a role" })).toBeInTheDocument();
  });

  it("names the safety officer", () => {
    setDemoRole("officer");
    renderWithIntl(<RoleBadge />);
    expect(screen.getByText("Demo: safety officer")).toBeInTheDocument();
  });

  it("with no stored role renders no label, still works, and offers Choose a role (a deep link is never blocked)", () => {
    const { container } = renderWithIntl(<RoleBadge />);
    expect(container.querySelector("[data-role-badge]")).not.toBeNull();
    expect(screen.queryByText(/^Demo:/)).toBeNull();
    expect(screen.getByRole("link", { name: "Choose a role" })).toHaveAttribute("href", "/en/start");
  });

  it("with storage that throws, still shows the role chosen on this page", () => {
    const boom = () => {
      throw new DOMException("blocked", "SecurityError");
    };
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(boom);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(boom);
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(boom);
    renderWithIntl(<RoleBadge />);
    expect(screen.getByRole("link", { name: "Choose a role" })).toBeInTheDocument();
    act(() => {
      setDemoRole("crew-lead");
    });
    expect(screen.getByText("Demo: crew lead")).toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it("keeps a touch target of at least 44 px on the link and a fixed height before the browser has answered", () => {
    const { container } = renderWithIntl(<RoleBadge />);
    expect(container.querySelector("[data-role-badge]")?.className).toMatch(/min-h-\(--target\)/);
    expect(screen.getByRole("link", { name: "Choose a role" }).className).toMatch(/min-h-\(--target\)/);
  });
});
