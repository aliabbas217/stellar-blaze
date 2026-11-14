import { screen } from "@testing-library/react";
import { Stamp } from "@/components/provenance/Stamp";
import { renderWithIntl } from "../../../utils/intl";

const KINDS = {
  REPLAY: "Replay",
  RECORDED: "Recorded",
  SIMULATED: "Simulated",
  DESIGNED: "Designed",
  DEV_2025: "DEV 2025",
  NOT_CLINICALLY_REVIEWED: "Not clinically reviewed",
} as const;

describe("Stamp", () => {
  it.each(Object.entries(KINDS))("%s reads %s", (kind, text) => {
    renderWithIntl(<Stamp kind={kind as keyof typeof KINDS} />);
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it("adds the detail after the label", () => {
    renderWithIntl(<Stamp kind="REPLAY" detail="3 Sep 2026" />);
    expect(screen.getByRole("note")).toHaveTextContent("Replay 3 Sep 2026");
  });

  it("isolates the detail with bdi, so a date inside right-to-left text keeps its order", () => {
    const { container } = renderWithIntl(<Stamp kind="REPLAY" detail="3 Sep 2026" />);
    expect(container.querySelector("bdi")).toHaveTextContent("3 Sep 2026");
  });

  it("is a note, so a screen reader reads it with the numbers it labels", () => {
    renderWithIntl(<Stamp kind="DEV_2025" />);
    expect(screen.getByRole("note")).toHaveTextContent("DEV 2025");
  });

  it("draws the unverified kinds dashed and the others solid", () => {
    for (const kind of ["DESIGNED", "NOT_CLINICALLY_REVIEWED"] as const) {
      const { container, unmount } = renderWithIntl(<Stamp kind={kind} />);
      expect(container.firstElementChild?.className, kind).toContain("border-dashed");
      unmount();
    }
    for (const kind of ["REPLAY", "RECORDED", "SIMULATED", "DEV_2025"] as const) {
      const { container, unmount } = renderWithIntl(<Stamp kind={kind} />);
      expect(container.firstElementChild?.className, kind).not.toContain("border-dashed");
      unmount();
    }
  });
});
