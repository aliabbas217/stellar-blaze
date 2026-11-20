import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DemoModeSwitch } from "@/components/shell/DemoModeSwitch";
import { renderWithIntl } from "../../utils/intl";

describe("DemoModeSwitch", () => {
  it("shows both modes and marks the chosen one", () => {
    renderWithIntl(<DemoModeSwitch value="replay" onChange={vi.fn()} liveUnavailable={false} />);
    expect(screen.getByRole("button", { name: "Replay" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Live" })).toHaveAttribute("aria-pressed", "false");
  });

  it("reports the tap", async () => {
    const onChange = vi.fn();
    renderWithIntl(<DemoModeSwitch value="replay" onChange={onChange} liveUnavailable={false} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Live" }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith("live");
  });

  it("when Live is unavailable it is disabled, not pressed, and a plain line says why", async () => {
    const onChange = vi.fn();
    renderWithIntl(<DemoModeSwitch value="live" onChange={onChange} liveUnavailable />);
    const live = screen.getByRole("button", { name: "Live" });
    expect(live).toBeDisabled();
    expect(live).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("status")).toHaveTextContent("Live feeds are not connected in this demo");
    expect(live).toHaveAccessibleDescription("Live feeds are not connected in this demo");
    await userEvent.setup().click(live);
    expect(onChange).not.toHaveBeenCalled();
    // Replay stays a normal button.
    expect(screen.getByRole("button", { name: "Replay" })).toBeEnabled();
  });

  it("says nothing extra otherwise", () => {
    renderWithIntl(<DemoModeSwitch value="live" onChange={vi.fn()} liveUnavailable={false} />);
    expect(screen.queryByText(/not connected/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Live" })).toBeEnabled();
  });
});
