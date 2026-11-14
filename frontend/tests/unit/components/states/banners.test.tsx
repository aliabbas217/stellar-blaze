import { screen } from "@testing-library/react";
import { MissingProvenance } from "@/components/states/MissingProvenance";
import { OfflineBanner } from "@/components/states/OfflineBanner";
import { PendingBanner } from "@/components/states/PendingBanner";
import { StaleBanner } from "@/components/states/StaleBanner";
import { renderWithIntl } from "../../../utils/intl";

describe("StaleBanner", () => {
  it("says 'Last known level' with the absolute time and the age", () => {
    renderWithIntl(<StaleBanner updatedAt="06:00" ageLabel="5 h" />);
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent("Last known level");
    expect(banner).toHaveTextContent("06:00");
    expect(banner).toHaveTextContent("5 h ago");
  });
});

describe("OfflineBanner", () => {
  it("says the phone is offline", () => {
    renderWithIntl(<OfflineBanner />);
    expect(screen.getByRole("status")).toHaveTextContent("You are offline");
  });

  it("adds the last known level time and age when it has them", () => {
    renderWithIntl(<OfflineBanner updatedAt="09:40" ageLabel="1 h 30 min" />);
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent("Last known level");
    expect(banner).toHaveTextContent("09:40");
    expect(banner).toHaveTextContent("1 h 30 min ago");
  });
});

describe("PendingBanner", () => {
  it("says what is not scored yet", () => {
    renderWithIntl(<PendingBanner what="The 2026 scoreboard" />);
    expect(screen.getByRole("status")).toHaveTextContent("The 2026 scoreboard is not scored yet");
  });
});

describe("MissingProvenance", () => {
  it("says the value is not shown because its source is missing, and shows no number", () => {
    renderWithIntl(<MissingProvenance what="Hours of work under the ban" />);
    const note = screen.getByRole("note");
    expect(note).toHaveTextContent("Hours of work under the ban");
    expect(note).toHaveTextContent("not shown");
    expect(note.textContent).not.toMatch(/\d/);
  });
});
