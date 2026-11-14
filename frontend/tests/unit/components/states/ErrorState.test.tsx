import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ErrorState } from "@/components/states/ErrorState";
import { renderWithIntl } from "../../../utils/intl";

describe("ErrorState", () => {
  // test_error_state_has_retry_and_request_id
  it("has a retry button that calls onRetry and shows the request id", async () => {
    const onRetry = vi.fn();
    renderWithIntl(
      <ErrorState title="Something went wrong" detail="We could not load this." onRetry={onRetry} requestId="req_7f3a91c2" />,
    );
    expect(screen.getByRole("heading", { name: "Something went wrong" })).toBeInTheDocument();
    expect(screen.getByText("We could not load this.")).toBeInTheDocument();
    expect(screen.getByText("req_7f3a91c2")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("copies the request id and says so", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    renderWithIntl(<ErrorState title="t" detail="d" onRetry={vi.fn()} requestId="req_7f3a91c2" />);

    await userEvent.click(screen.getByRole("button", { name: "Copy request ID" }));
    expect(writeText).toHaveBeenCalledWith("req_7f3a91c2");
    expect(screen.getByRole("status")).toHaveTextContent("Copied");
    vi.unstubAllGlobals();
  });

  it("shows no request id and no copy button when there is none", () => {
    renderWithIntl(<ErrorState title="t" detail="d" onRetry={vi.fn()} requestId={null} />);
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy request ID" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Request ID/)).not.toBeInTheDocument();
  });

  it("renders extra guidance under the detail (the site rules), so an error is never a dead end", () => {
    renderWithIntl(
      <ErrorState title="t" detail="d" onRetry={vi.fn()} requestId={null}>
        <p>Follow the site rules.</p>
      </ErrorState>,
    );
    expect(screen.getByText("Follow the site rules.")).toBeInTheDocument();
  });
});
