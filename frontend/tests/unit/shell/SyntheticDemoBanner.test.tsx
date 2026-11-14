import { screen } from "@testing-library/react";
import { SyntheticDemoBanner } from "@/components/shell/SyntheticDemoBanner";
import { renderWithIntl } from "../../utils/intl";

describe("SyntheticDemoBanner (ADR 0062)", () => {
  it("says the site is synthetic and names it", () => {
    renderWithIntl(<SyntheticDemoBanner siteName="Mussafah M-14 yard (synthetic)" />);
    const note = screen.getByRole("note");
    expect(note).toHaveTextContent("Synthetic demo site: no real people, no real data");
    expect(note).toHaveTextContent("Mussafah M-14 yard (synthetic)");
  });

  it("still says it before the site is known", () => {
    renderWithIntl(<SyntheticDemoBanner siteName={null} />);
    expect(screen.getByRole("note")).toHaveTextContent("Synthetic demo site: no real people, no real data");
  });

  it("contains no em or en dash in its visible copy", () => {
    renderWithIntl(<SyntheticDemoBanner siteName="Yard" />);
    expect(screen.getByRole("note").textContent).not.toMatch(/[–—]/);
  });
});
