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

  it("says live is not running when the API answered with a replay", () => {
    renderWithIntl(<DemoModeSwitch value="live" onChange={vi.fn()} liveUnavailable />);
    expect(screen.getByRole("status")).toHaveTextContent("Live is not running on this deployment");
  });

  it("says nothing extra otherwise", () => {
    renderWithIntl(<DemoModeSwitch value="live" onChange={vi.fn()} liveUnavailable={false} />);
    expect(screen.queryByText(/not running/)).not.toBeInTheDocument();
  });
});
