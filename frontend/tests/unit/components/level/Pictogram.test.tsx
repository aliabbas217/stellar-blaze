import { render } from "@testing-library/react";
import { PICTOGRAM_NAMES, Pictogram } from "@/components/level/Pictogram";

describe("Pictogram", () => {
  it("offers the nine names of the brief", () => {
    expect([...PICTOGRAM_NAMES].sort()).toEqual(
      ["buddy", "clock", "cross", "handset", "moon", "shade", "speaker", "sun", "water"].sort(),
    );
  });

  it.each(PICTOGRAM_NAMES)("draws %s on a 24 grid in currentColor", (name) => {
    const { container } = render(<Pictogram name={name} />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("viewBox", "0 0 24 24");
    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|hsl\(|oklch\(/i);
    expect(container.innerHTML).toContain("currentColor");
    expect(container.querySelectorAll("path,circle,rect,line").length).toBeGreaterThan(0);
  });

  it("is decorative without a label", () => {
    const { container } = render(<Pictogram name="shade" />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).not.toHaveAttribute("role");
  });

  it("is an image with a name when it has a label", () => {
    const { getByRole, container } = render(<Pictogram name="cross" label="Medical help" />);
    expect(getByRole("img", { name: "Medical help" })).toBeInTheDocument();
    expect(container.querySelector("svg")).not.toHaveAttribute("aria-hidden");
  });

  it("draws unwell as a plain medical cross, not a phone", () => {
    const { container } = render(<Pictogram name="cross" />);
    // A cross is one polygon path of straight segments only; it has no curve commands.
    const d = container.querySelector("path")?.getAttribute("d") ?? "";
    expect(d).not.toMatch(/[acCsSqQ]/);
  });
});
