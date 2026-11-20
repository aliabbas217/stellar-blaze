import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ViolationList } from "@/features/judge/validator/ViolationList";
import type { ViolationView } from "@/features/judge/validator/view";
import { BlockRows } from "@/features/supervisor/plan/BlockRows";
import type { PlanBlock } from "@/features/supervisor/plan/plan-model";
import { ShiftNotLegalResult } from "@/features/supervisor/plan/ShiftNotLegalResult";
import enMessages from "../../../messages/en.json";
import { renderWithIntl } from "../../utils/intl";

/*
 * Audit M2: a judge read `P-H7.cap60` and `STOP.red` with no words. Each rule id is now shown with a plain-language name FIRST and the id
 * as a small secondary code (auditors still cite the id); an id the app has no name for shows the code alone, never an invented name.
 */

const NAMES = enMessages.judge.try.rules;
const SUP_NAMES = enMessages.supervisor.plan.rules;

const violation = (ruleId: string): ViolationView => ({ ruleId, sourceId: "adosh-twl", clause: "", detail: "work run longer than the cycle's work length", ranges: [{ fromMin: 780, toMin: 840 }] });

describe("rule names on the judge's validator result", () => {
  it("test_violation_shows_name_then_code: 'Work run too long, or rest too short' first, `P-H7.run` kept as the small code", () => {
    const { container } = renderWithIntl(<ViolationList violations={[violation("P-H7.run"), violation("STOP.red")]} />);

    const first = container.querySelector("[data-violation='1']") as HTMLElement;
    const name = first.querySelector("[data-rule-name]") as HTMLElement;
    const code = first.querySelector("[data-rule-id]") as HTMLElement;
    expect(name.textContent).toBe(NAMES.pH7Run);
    expect(code.textContent).toBe("P-H7.run");
    expect(code).toHaveAttribute("translate", "no");
    // name before code in reading order
    expect(name.compareDocumentPosition(code) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(container.querySelector("[data-violation='2']") as HTMLElement).getByText(NAMES.stopRed)).toBeInTheDocument();
  });

  it("an unknown rule id shows the code alone: no name element, no invented words", () => {
    const { container } = renderWithIntl(<ViolationList violations={[violation("P-H99.mystery")]} />);

    expect(container.querySelector("[data-rule-name]")).toBeNull();
    expect(container.querySelector("[data-rule-id]")?.textContent).toBe("P-H99.mystery");
  });
});

const block = (ruleId: string, clause: string): PlanBlock => ({
  index: 0,
  startsAt: "2026-09-03T09:00:00Z",
  endsAt: "2026-09-03T10:00:00Z",
  fromMin: 780,
  toMin: 840,
  state: "stopped",
  zone: "red",
  ruleId,
  clause,
});

describe("rule names on the supervisor's crew plan", () => {
  it("test_block_rule_shows_name_then_code: 'Rule Stop work in the red zone STOP.red' and the clause without the config key", async () => {
    const { container } = renderWithIntl(
      <BlockRows blocks={[block("STOP.red", "Decisions 2 and 8: below the Red edge (red_twl_w_m2) every crew is stopped. POLICY, beyond the ADOSH table: stop work")]} currentIndex={-1} nowMin={null} />,
    );
    await userEvent.setup().click(screen.getByRole("button", { expanded: false }));

    const panel = container.querySelector("[data-block] div[id]") as HTMLElement;
    expect(panel.querySelector("[data-rule-name]")?.textContent).toBe(SUP_NAMES.stopRed);
    expect(panel.querySelector("[data-rule-id]")?.textContent).toBe("STOP.red");
    expect(panel.textContent).not.toContain("red_twl_w_m2");
  });

  it("the shift-not-legal list names each rule it breaks and keeps the id", () => {
    const { container } = renderWithIntl(
      <ShiftNotLegalResult violations={[{ rule_id: "P-H2.daily", clause: "", source_id: "fdl-33-2021" }, { rule_id: "P-H99.mystery", clause: "", source_id: "" }]} />,
    );

    const daily = container.querySelector("[data-violation='P-H2.daily']") as HTMLElement;
    expect(daily.querySelector("[data-rule-name]")?.textContent).toBe(SUP_NAMES.pH2Daily);
    expect(daily.querySelector("[data-rule-id]")?.textContent).toBe("P-H2.daily");
    const unknown = container.querySelector("[data-violation='P-H99.mystery']") as HTMLElement;
    expect(unknown.querySelector("[data-rule-name]")).toBeNull();
    expect(unknown.querySelector("[data-rule-id]")?.textContent).toBe("P-H99.mystery");
  });
});
