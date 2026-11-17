import { act, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { createRef, type ReactNode } from "react";
import { HourScrubber, type NowHandle } from "@/features/judge/landing/HourScrubber";
import messages from "../../../../../messages/en.json";

/*
 * Fix round 3, minor 5: the now line of the scrubber moves through a handle (a DOM write per frame), not through React state, so a
 * playing day does not re-render the island sixty times a second. React still owns the line when it commits (an hour change, a
 * pause): the handle's last position is put back after every commit, so a commit never snaps the line back for a frame.
 */

const values = Array.from({ length: 24 }, (_, h) => 28 + h / 4);
const base = { values, ban: { kind: "in-force", fromHour: 12.5, toHour: 15 } as const, dir: "ltr", dayLabel: "Thu 3 Sep 2026", valueText: "14:00", interactive: true, calm: false } as const;

function scrubber(position: number, hour: number, playing: boolean, ref: React.Ref<NowHandle>, dir: "ltr" | "rtl" = "ltr") {
  return <HourScrubber {...base} dir={dir} position={position} hour={hour} playing={playing} nowRef={ref} />;
}

function wrapper({ children }: { readonly children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={messages} timeZone="Asia/Dubai">
      {children}
    </NextIntlClientProvider>
  );
}

const x1 = (): number => Number(document.querySelector("[data-now]")?.getAttribute("x1"));

describe("the scrubber's now line is moved through a handle", () => {
  it("test_now_handle_moves_the_line_without_a_render: move(10.5) puts the line at 10.5/24 of the track", () => {
    const ref = createRef<NowHandle>();
    render(scrubber(14, 14, true, ref), { wrapper });
    expect(x1()).toBeCloseTo((14 / 24) * 100, 2);
    act(() => {
      ref.current?.move(10.5);
    });
    expect(x1()).toBeCloseTo((10.5 / 24) * 100, 2);
  });

  it("mirrors in right-to-left like the spine does", () => {
    const ref = createRef<NowHandle>();
    render(scrubber(14, 14, true, ref, "rtl"), { wrapper });
    act(() => {
      ref.current?.move(6);
    });
    expect(x1()).toBeCloseTo(100 - (6 / 24) * 100, 2);
  });

  it("test_commit_does_not_snap_the_line_back: after an hour-change commit the line is where the last frame put it, not at the whole hour", () => {
    const ref = createRef<NowHandle>();
    const { rerender } = render(scrubber(14, 14, true, ref), { wrapper });
    act(() => {
      ref.current?.move(15.02);
    });
    // the clock's hour state turns 15 in the same frame: React commits position 15 (a whole hour), the line must stay at 15.02
    rerender(scrubber(15, 15, true, ref));
    expect(x1()).toBeCloseTo((15.02 / 24) * 100, 2);
  });
});
