import { act, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { WAKING_DELAY_MS, WakingLine } from "@/components/states/WakingLine";
import enMessages from "../../../../messages/en.json";
import { renderWithIntl } from "../../../utils/intl";

/*
 * The quiet line a LIVE loading state adds when the API is slow to answer (it scales to zero, and the first read after a quiet
 * period waits for it to wake). One timer; the line is mounted with the loading state, so it is gone the moment the read
 * settles and the loading state is replaced.
 */

const SENTENCE = "Waking up the service. The first load after a quiet period can take longer.";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("WakingLine", () => {
  it("shows nothing for the first 3 seconds, and the sentence at 3 seconds", () => {
    renderWithIntl(<WakingLine />);
    const region = screen.getByRole("status");
    expect(region).toHaveTextContent("");

    act(() => void vi.advanceTimersByTime(WAKING_DELAY_MS - 1));
    expect(region).toHaveTextContent("");

    act(() => void vi.advanceTimersByTime(1));
    expect(region).toHaveTextContent(SENTENCE);
  });

  it("the delay is 3000 ms", () => {
    expect(WAKING_DELAY_MS).toBe(3000);
  });

  it("is a polite live region that is in the document from the start, so the text is announced when it arrives", () => {
    renderWithIntl(<WakingLine />);

    const region = screen.getByRole("status");
    expect(region).not.toHaveAttribute("aria-live", "assertive");
    expect(region).not.toHaveAttribute("aria-hidden");
    expect(region).not.toHaveAttribute("aria-busy");
    expect(region).toBeEmptyDOMElement();
  });

  it("never shows when the read settles first (the loading state, and the line with it, unmounts)", () => {
    const { unmount, container } = renderWithIntl(<WakingLine />);

    act(() => void vi.advanceTimersByTime(WAKING_DELAY_MS - 500));
    unmount();
    act(() => void vi.advanceTimersByTime(WAKING_DELAY_MS * 2));

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("clears its timer on unmount (nothing is left to fire)", () => {
    const { unmount } = renderWithIntl(<WakingLine />);
    expect(vi.getTimerCount()).toBe(1);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });

  it("starts exactly one timer, whatever re-renders", () => {
    const withIntl = (ui: ReactElement) => (
      <NextIntlClientProvider locale="en" messages={enMessages} timeZone="Asia/Dubai">
        {ui}
      </NextIntlClientProvider>
    );
    const { rerender } = renderWithIntl(<WakingLine />);
    rerender(withIntl(<WakingLine />));
    rerender(withIntl(<WakingLine className="px-4" />));

    expect(vi.getTimerCount()).toBe(1);
  });

  it("the server's HTML has an empty live region, the same as the first client render (nothing to mismatch when it hydrates)", () => {
    const html = renderToString(
      <NextIntlClientProvider locale="en" messages={enMessages} timeZone="Asia/Dubai">
        <WakingLine />
      </NextIntlClientProvider>,
    );

    expect(html).toMatch(/<p role="status"[^>]*><\/p>/);
    // The only copy of the sentence is the invisible, aria-hidden reserve.
    expect(html.match(/Waking up the service/g)).toHaveLength(1);
    expect(html).toMatch(/aria-hidden="true"[^>]*class="invisible[^"]*"[^>]*>Waking up|class="invisible[^"]*"[^>]*aria-hidden="true"[^>]*>Waking up/);
  });

  it("reserves the height of the sentence from the first paint, so its arrival moves nothing", () => {
    const { container } = renderWithIntl(<WakingLine />);

    // An invisible copy of the sentence holds the room (visibility: hidden keeps layout), hidden from assistive technology.
    const reserve = container.querySelector("[aria-hidden='true']");
    expect(reserve).toHaveTextContent(SENTENCE);
    expect(reserve?.className).toContain("invisible");
    // And it is not inside the live region, which must be empty until the line is due.
    expect(screen.getByRole("status")).not.toContainElement(reserve as HTMLElement);
  });

  it("has no animation of its own and no fixed pixel size", () => {
    const { container } = renderWithIntl(<WakingLine />);

    expect(container.innerHTML).not.toMatch(/animate-|transition|\d+px/);
  });
});
