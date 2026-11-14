import { screen, within } from "@testing-library/react";
import { Counter } from "@/components/provenance/Counter";
import { ScoreboardTable, type ScoreRow } from "@/components/provenance/ScoreboardTable";
import { Verdict } from "@/components/provenance/Verdict";
import type { Proof } from "@/components/provenance/proof";
import { renderWithIntl } from "../../../utils/intl";

const proof: Proof = {
  what: "Danger hours nobody was warned about, Stellar Blaze",
  protocol: "docs/research/preregistration.md#72-warnings-row",
  protocolHref: null,
  script: "backend.eval.policy_scoreboard:build @ 661b373a1b2c",
  file: "eval/2026/policy_scoreboard.json",
  fileSha256: "f".repeat(64),
  sourceSha256: "a".repeat(64),
  label: "REAL",
  modelId: null,
  generatedAt: "2026-11-12T09:14:00Z",
};

const columns = [
  { key: "missed", heading: "Danger hours nobody was warned about" },
  { key: "false", heading: "False-alarm hours" },
];

function row(id: string, ours: boolean, withProof: Proof | null = proof): ScoreRow {
  return {
    id,
    label: `Policy ${id}`,
    sublabel: `how ${id} warns`,
    ours,
    cells: [
      { value: "12.3", interval: "95% interval 10.1 to 14.2", what: `missed, ${id}`, proof: withProof },
      { value: "4.5", what: `false, ${id}`, proof: withProof },
    ],
  };
}

function table(rows: readonly ScoreRow[], pending = false) {
  return renderWithIntl(<ScoreboardTable caption="Warnings" rowHeading="Policy" columns={columns} rows={rows} pending={pending} />);
}

describe("ScoreboardTable", () => {
  it("test_pending_table_has_no_cells_with_proof", () => {
    const { container } = table([row("P0", false), row("P3", true)], true);
    // every number cell reads ### with the accessible name "not scored yet", and no proof chip or number is offered
    expect(screen.getAllByRole("img", { name: "not scored yet" })).toHaveLength(4);
    expect(screen.getAllByText("###")).toHaveLength(4);
    expect(container.querySelector("[data-proof-id]")).toBeNull();
    expect(screen.queryByText("12.3")).toBeNull();
    expect(screen.queryByText("4.5")).toBeNull();
  });

  it("test_scoreboard_row_without_proof_is_not_rendered_as_number", () => {
    const { container } = table([row("P0", false, null), row("P3", true)]);
    const rows = container.querySelectorAll("tbody tr");
    const unproved = rows[0];
    if (unproved === undefined) throw new Error("no row");
    expect(within(unproved as HTMLElement).queryByText("12.3")).toBeNull();
    expect(within(unproved as HTMLElement).queryByText("4.5")).toBeNull();
    expect(within(unproved as HTMLElement).getAllByRole("note").length).toBe(2);
    // the proved row still shows its numbers and a chip for each
    const proved = rows[1] as HTMLElement;
    expect(within(proved).getByText("12.3")).toBeInTheDocument();
    expect(proved.querySelectorAll("[data-proof-id]")).toHaveLength(2);
  });

  it("test_ours_marked_by_aria_current_not_colour_only", () => {
    const { container } = table([row("P0", false), row("P3", true)]);
    const rows = [...container.querySelectorAll("tbody tr")];
    expect(rows.map((r) => r.getAttribute("aria-current"))).toEqual([null, "true"]);
    // a text for assistive technology says which row it is, and the row is bold and last: not colour alone
    expect(within(rows[1] as HTMLElement).getByText("This is the Stellar Blaze row.")).toBeInTheDocument();
    expect(rows[1]?.className).toContain("font-medium");
  });

  it("keeps the column headings as the labels of each value for the stacked layout", () => {
    const { container } = table([row("P0", false)]);
    const cells = [...container.querySelectorAll("tbody td")];
    expect(cells.map((c) => c.getAttribute("data-label"))).toEqual(columns.map((c) => c.heading));
  });

  it("shows the interval beside a proved number and none without a proof", () => {
    table([row("P0", false)]);
    expect(screen.getByText("95% interval 10.1 to 14.2")).toBeInTheDocument();
  });
});

describe("Counter", () => {
  it("test_counter_without_provenance_renders_missing", () => {
    const { container } = renderWithIntl(
      <Counter value="1,624" unit="working hours above the limit" interval="of 1,807" proof={null} size="mega" />,
    );
    expect(container.textContent).not.toContain("1,624");
    expect(container.textContent).not.toContain("of 1,807");
    expect(screen.getByRole("note")).toBeInTheDocument();
  });

  it("shows the value, what it counts, its interval and a chip when it has a proof", () => {
    const { container } = renderWithIntl(
      <Counter value="1,624" unit="working hours above the limit" interval="of 1,807" proof={proof} size="numeral" danger />,
    );
    expect(screen.getByText("1,624")).toBeInTheDocument();
    expect(screen.getByText("working hours above the limit")).toBeInTheDocument();
    expect(screen.getByText("of 1,807")).toBeInTheDocument();
    expect(container.querySelector("[data-proof-id]")).not.toBeNull();
    expect(container.querySelector("[data-level-mark]")).not.toBeNull();
  });
});

describe("Verdict", () => {
  it("says the outcome is chosen after the scoring run when there is no sentence", () => {
    renderWithIntl(<Verdict sentence={null} proof={null} />);
    expect(screen.getByText("Chosen from the pre-registered outcome table after the single scoring run.")).toBeInTheDocument();
  });

  it("shows the sentence exactly as written, with its proof", () => {
    const { container } = renderWithIntl(<Verdict sentence="Stellar Blaze warned about more danger hours than the regulator's zones." proof={proof} />);
    expect(screen.getByText("Stellar Blaze warned about more danger hours than the regulator's zones.")).toBeInTheDocument();
    expect(container.querySelector("[data-proof-id]")).not.toBeNull();
  });

  it("does not show a sentence that has no provenance", () => {
    const { container } = renderWithIntl(<Verdict sentence="We won." proof={null} />);
    expect(container.textContent).not.toContain("We won.");
  });
});
