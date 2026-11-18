import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { Proved } from "@/components/provenance/Proved";
import { ProofChip } from "@/components/provenance/ProofChip";
import type { Proof } from "@/components/provenance/proof";
import { server } from "@/mocks/node";
import { renderWithIntl } from "../../../utils/intl";
import { SAMPLE_STORY } from "../../../utils/story";

// The locale-aware Link needs the Next.js app router; only the href it is given matters here (the drawer links to the proof sheet).
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

const BODY = "stellar blaze";

/** The technical record is behind "For auditors" (a closed <details>): a reader opens it on purpose. */
async function openAudit(dialog: HTMLElement): Promise<void> {
  await userEvent.click(within(dialog).getByText("For auditors: the full record"));
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function proofOf(overrides: Partial<Proof> = {}): Proof {
  return {
    what: "Alerts per shift, P3 protect",
    story: SAMPLE_STORY,
    protocol: "docs/protocol/preregistration.md#72-warnings-row",
    protocolHref: null,
    script: "backend.eval.policy_scoreboard:build_policy_scoreboard @ 661b373a1b2c",
    file: "static/recount-sample.json",
    fileSha256: "f".repeat(64),
    sourceSha256: "a".repeat(64),
    label: "REAL",
    modelId: "corrector-20261112-0000000-000001",
    generatedAt: "2026-11-12T09:14:00Z",
    ...overrides,
  };
}

// jsdom 31 has HTMLDialogElement but neither showModal nor close. This stands in for the two methods the way the HTML
// spec defines the parts the drawer relies on: showModal opens the dialog and moves focus into it, Escape fires `cancel`
// and then closes, close fires `close`. It deliberately does NOT restore focus on close (the browser does, but the
// drawer must not depend on that: Safari and a removed trigger both break it), so the focus-return test checks the
// component's own code.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
    this.querySelector<HTMLElement>("button, a[href]")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const cancel = new Event("cancel", { cancelable: true });
      this.dispatchEvent(cancel);
      if (!cancel.defaultPrevented) this.close();
    };
    document.addEventListener("keydown", onKey);
    this.addEventListener(
      "close",
      () => {
        document.removeEventListener("keydown", onKey);
      },
      { once: true },
    );
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    if (!this.hasAttribute("open")) return;
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});

describe("ProofChip", () => {
  it("test_proof_chip_null_renders_nothing", () => {
    const { container } = renderWithIntl(<ProofChip proof={null} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("is a plain button named for the number it proves, with an id and no JSON in its attributes", () => {
    const { container } = renderWithIntl(<ProofChip proof={proofOf()} />);
    const chip = screen.getByRole("button", { name: /Alerts per shift, P3 protect/ });
    expect(chip).toHaveTextContent("Where from");
    expect(chip).toHaveAttribute("type", "button");
    expect(chip.getAttribute("data-proof-id")).toBeTruthy();
    expect(container.innerHTML).not.toContain("{");
    // The drawer is not in the page until the first click: its code is a dynamic import.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("names itself for the number it explains, in a name that contains its visible words (WCAG 2.5.3)", () => {
    renderWithIntl(<ProofChip proof={proofOf()} />);
    const chip = screen.getByRole("button", { name: "Where from: Alerts per shift, P3 protect" });
    expect(chip.getAttribute("aria-label")).toContain(chip.textContent);
  });

  it("opens the plain story first on the first click, and keeps the technical record behind For auditors", async () => {
    renderWithIntl(<ProofChip proof={proofOf()} />);
    await userEvent.click(screen.getByRole("button", { name: /Alerts per shift/ }));
    const dialog = await screen.findByRole("dialog", { name: "Where this number comes from" });
    for (const row of ["Made by", "About", "How we counted", "It shows", "It does not show"]) {
      expect(within(dialog).getByText(row)).toBeInTheDocument();
    }
    expect(within(dialog).getByText("Alerts per shift, P3 protect")).toBeInTheDocument();
    expect(within(dialog).getByText(/Real weather\./)).toBeInTheDocument();
    expect(within(dialog).getByText("For auditors: the full record").closest("details")).not.toHaveAttribute("open");
    await openAudit(dialog);
    for (const row of ["Protocol line", "Script", "Result file", "SHA-256", "Label", "Model", "Generated"]) {
      expect(within(dialog).getByText(row)).toBeInTheDocument();
    }
    expect(within(dialog).getByText("docs/protocol/preregistration.md#72-warnings-row")).toBeInTheDocument();
    expect(within(dialog).getByText("f".repeat(64))).toBeInTheDocument();
    expect(within(dialog).getByText("a".repeat(64))).toBeInTheDocument();
    expect(within(dialog).getByText("REAL")).toBeInTheDocument();
  });

  it("the story part of the drawer never prints a file path, a hash, a function name or a placeholder", async () => {
    renderWithIntl(<ProofChip proof={proofOf({ fileSha256: null, sourceSha256: null, modelId: null, generatedAt: null })} />);
    await userEvent.click(screen.getByRole("button", { name: /Alerts per shift/ }));
    const dialog = await screen.findByRole("dialog");
    const story = dialog.querySelector("[data-story]");
    expect(story).not.toBeNull();
    expect(story?.textContent).not.toMatch(/[A-Za-z0-9_-]+\.(json|md|ts|py)\b|[0-9a-f]{40,}|src\/|Not recorded|policy=|config=/);
  });

  it("links the protocol line only when a protocol URL exists", async () => {
    renderWithIntl(<ProofChip proof={proofOf({ protocolHref: "https://example.test/protocol#72" })} />);
    await userEvent.click(screen.getByRole("button", { name: /Alerts per shift/ }));
    const dialog = await screen.findByRole("dialog");
    await openAudit(dialog);
    expect(within(dialog).getByRole("link", { name: /preregistration\.md#72-warnings-row/ })).toHaveAttribute(
      "href",
      "https://example.test/protocol#72",
    );
  });

  it("test_drawer_focus_return_and_escape", async () => {
    renderWithIntl(<ProofChip proof={proofOf()} />);
    const chip = screen.getByRole("button", { name: /Alerts per shift/ });

    await userEvent.click(chip);
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    expect(chip).not.toHaveFocus();

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(chip).toHaveFocus();

    // Reopened (no second import) and closed with the Close button: focus returns again.
    await userEvent.click(chip);
    await userEvent.click(await screen.findByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(chip).toHaveFocus();
  });

  it("closes on a click on the backdrop, not on a click inside the panel", async () => {
    renderWithIntl(<ProofChip proof={proofOf()} />);
    await userEvent.click(screen.getByRole("button", { name: /Alerts per shift/ }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByText("Made by"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await userEvent.click(dialog);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("test_drawer_recount_matches_and_flags_a_changed_file: says Matches, then Does not match for a changed file", async () => {
    server.use(http.get("/data/static/recount-sample.json", () => new HttpResponse(BODY)));
    const { unmount } = renderWithIntl(<ProofChip proof={proofOf({ fileSha256: await sha256(BODY) })} />);
    await userEvent.click(screen.getByRole("button", { name: /Alerts per shift/ }));
    await openAudit(await screen.findByRole("dialog"));
    await userEvent.click(await screen.findByRole("button", { name: "Recount in this browser" }));
    expect(await screen.findByText("Matches")).toBeInTheDocument();
    unmount();

    renderWithIntl(<ProofChip proof={proofOf({ fileSha256: "0".repeat(64) })} />);
    await userEvent.click(screen.getByRole("button", { name: /Alerts per shift/ }));
    await openAudit(await screen.findByRole("dialog"));
    await userEvent.click(await screen.findByRole("button", { name: "Recount in this browser" }));
    expect(await screen.findByText("Does not match: report this")).toBeInTheDocument();
    expect(screen.queryByText("Matches")).not.toBeInTheDocument();
  });

  it("does not claim a match when the file cannot be read", async () => {
    server.use(http.get("/data/static/recount-sample.json", () => new HttpResponse(null, { status: 500 })));
    renderWithIntl(<ProofChip proof={proofOf()} />);
    await userEvent.click(screen.getByRole("button", { name: /Alerts per shift/ }));
    await openAudit(await screen.findByRole("dialog"));
    await userEvent.click(await screen.findByRole("button", { name: "Recount in this browser" }));
    expect(await screen.findByText(/could not be read/)).toBeInTheDocument();
    expect(screen.queryByText("Matches")).not.toBeInTheDocument();
  });

  it("offers no recount for a file that is not published, and says why", async () => {
    renderWithIntl(<ProofChip proof={proofOf({ file: "eval/dev/demo_day.2025.json" })} />);
    await userEvent.click(screen.getByRole("button", { name: /Alerts per shift/ }));
    const dialog = await screen.findByRole("dialog");
    await openAudit(dialog);
    expect(within(dialog).queryByRole("button", { name: "Recount in this browser" })).not.toBeInTheDocument();
    expect(within(dialog).getByText(/not published here/)).toBeInTheDocument();
  });

  it("links to the proof sheet, and to its For auditors section, only for a number that has one", async () => {
    const { unmount } = renderWithIntl(<ProofChip proof={proofOf({ claim: "policy.p3.missed_danger_hours" })} />);
    await userEvent.click(screen.getByRole("button", { name: /Alerts per shift, P3 protect/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("link", { name: "Open the proof sheet" })).toHaveAttribute("href", "/replay/proof/policy.p3.missed_danger_hours");
    expect(within(dialog).getByRole("link", { name: "For auditors" })).toHaveAttribute("href", "/replay/proof/policy.p3.missed_danger_hours#audit");
    expect(within(dialog).queryByText("For auditors: the full record")).toBeNull();
    unmount();
    renderWithIntl(<ProofChip proof={proofOf()} />);
    await userEvent.click(screen.getByRole("button", { name: /Alerts per shift, P3 protect/ }));
    expect(within(await screen.findByRole("dialog")).queryByRole("link", { name: "Open the proof sheet" })).toBeNull();
  });

  it("skips a missing fingerprint, model or time: no Not recorded, no empty row", async () => {
    renderWithIntl(<ProofChip proof={proofOf({ fileSha256: null, sourceSha256: null, modelId: null, generatedAt: null })} />);
    await userEvent.click(screen.getByRole("button", { name: /Alerts per shift/ }));
    const dialog = await screen.findByRole("dialog");
    await openAudit(dialog);
    expect(within(dialog).queryByText("Not recorded")).toBeNull();
    for (const row of ["SHA-256", "Model", "Generated"]) expect(within(dialog).queryByText(row)).toBeNull();
    expect(within(dialog).getByText("Protocol line")).toBeInTheDocument();
  });
});

describe("Proved", () => {
  it("shows the value with its chip when there is a proof", () => {
    renderWithIntl(
      <Proved proof={proofOf()} what="Alerts per shift">
        <span>2.6</span>
      </Proved>,
    );
    expect(screen.getByText("2.6")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Alerts per shift/ })).toBeInTheDocument();
  });

  it("shows MissingProvenance and never the value when there is no proof", () => {
    const { container } = renderWithIntl(
      <Proved proof={null} what="Alerts per shift">
        <span>2.6</span>
      </Proved>,
    );
    expect(screen.getByRole("note")).toHaveTextContent("Alerts per shift is not shown because its source is missing.");
    expect(container).not.toHaveTextContent("2.6");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("has a field size: a 44 px target and 16 px text, where the desk chip is 28 px", () => {
    const first = renderWithIntl(<ProofChip proof={proofOf()} />);
    const desk = screen.getByRole("button", { name: /Where from/ });
    expect(desk.className).toContain("min-h-7");
    expect(desk.className).not.toContain("min-h-(--target)");
    first.unmount();
    renderWithIntl(<ProofChip proof={proofOf()} field />);
    const field = screen.getByRole("button", { name: /Where from/ });
    expect(field.className).toContain("min-h-(--target)");
    expect(field.className).toContain("min-w-(--target)");
    expect(field.className).toContain("text-base");
    expect(field.className).toContain("touch-manipulation");
  });

  it("labelContent is the visible label (a level name in <bdi>) in one element, and the accessible name stays the plain label", () => {
    renderWithIntl(<ProofChip proof={proofOf()} field label="Why Orange?" labelContent={<>Why <bdi>Orange</bdi>?</>} />);
    const chip = screen.getByRole("button", { name: "Why Orange?" });
    // The chip is a flex row with a gap: text, <bdi>, text as three items would read "Why Orange ?". One span keeps the sentence whole.
    const spans = [...chip.querySelectorAll(":scope > span")].filter((span) => span.getAttribute("aria-hidden") === null);
    expect(spans).toHaveLength(1);
    expect(spans[0]?.textContent).toBe("Why Orange?");
    expect(spans[0]?.querySelector("bdi")?.textContent).toBe("Orange");
  });
});
