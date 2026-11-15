import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { useEffect, type ComponentType } from "react";
import { IslandStatus } from "@/features/judge/live/IslandStatus";
import { lastModeTap, useIslandGate, type IslandProps } from "@/features/judge/live/useIslandGate";
import { renderWithIntl } from "../../../utils/intl";

/*
 * The gate that loads the interactive island of a judge page (Part G3 C1, I1, M1). The island here is a probe that records what it
 * was handed, so the contract is pinned without a real page: warming only preloads and never changes the DOM, an ACTION (click or
 * submit) swaps the island in and is handed over once, taps made while loading keep their order, a failed load drops the queue and
 * says so, and the next click retries.
 */

interface Handed extends IslandProps {
  readonly probe: (props: IslandProps) => void;
}

function Island({ probe, ...props }: Handed) {
  useEffect(() => {
    probe(props);
    // handed over once, on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <p>island is here</p>;
}

function Gate({ load, probe }: { readonly load: () => Promise<{ default: ComponentType<Handed> }>; readonly probe: (props: IslandProps) => void }) {
  const gate = useIslandGate<Handed>(load);
  if (gate.Island !== null) {
    const Loaded = gate.Island;
    return <Loaded probe={probe} {...gate.handoff} />;
  }
  return (
    <div {...gate.handlers}>
      <form noValidate>
        <input aria-label="time" data-island-field="time" defaultValue="" />
        <button type="button" data-island-action="reset">
          Reset
        </button>
        <button type="submit" data-island-action="check">
          Check
        </button>
        <button type="button" data-island-action="send">
          Send
        </button>
      </form>
      <IslandStatus failed={gate.failed} />
    </div>
  );
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

function setup(load: () => Promise<{ default: ComponentType<Handed> }>) {
  const handed: IslandProps[] = [];
  renderWithIntl(<Gate load={load} probe={(props) => handed.push(props)} />);
  return handed;
}

const resolves = () => vi.fn(() => Promise.resolve({ default: Island }));

describe("useIslandGate: warming only preloads", () => {
  it("test_focus_alone_never_swaps_the_dom: focus and pointerdown load the chunk once, nothing is replaced, nothing is handed over", async () => {
    const load = resolves();
    const handed = setup(load);
    const field = screen.getByLabelText("time");
    const send = screen.getByRole("button", { name: "Send" });
    field.focus();
    fireEvent.pointerDown(send);
    send.focus();
    await settle();
    expect(load).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("time")).toBe(field);
    expect(screen.getByRole("button", { name: "Send" })).toBe(send);
    expect(document.activeElement).toBe(send);
    expect(screen.queryByText("island is here")).toBeNull();
    expect(handed).toEqual([]);
  });

  it("test_pointerdown_then_click_on_old_node_hands_over_exactly_once: the chunk resolves under the press and the pressed node is still attached", async () => {
    const handed = setup(resolves());
    const send = screen.getByRole("button", { name: "Send" });
    fireEvent.pointerDown(send);
    await settle();
    // pointerup and click would be dispatched on this very node: it must still be in the document
    expect(send.isConnected).toBe(true);
    expect(handed).toEqual([]);
    fireEvent.click(send);
    expect(await screen.findByText("island is here")).toBeInTheDocument();
    await waitFor(() => {
      expect(handed).toHaveLength(1);
    });
    expect(handed[0]?.initialActions).toEqual(["send"]);
  });

  it("carries what was typed and the focused control over the swap", async () => {
    const handed = setup(resolves());
    const field = screen.getByLabelText("time");
    fireEvent.change(field, { target: { value: "06:05" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("island is here");
    expect(handed[0]?.fields).toEqual({ time: "06:05" });
  });
});

describe("useIslandGate: actions", () => {
  it("test_second_click_while_loading_is_queued: Reset then Send arrive in the order tapped, once each", async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const handed = setup(() => held.then(() => ({ default: Island })));
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    release();
    await screen.findByText("island is here");
    await waitFor(() => {
      expect(handed).toHaveLength(1);
    });
    expect(handed[0]?.initialActions).toEqual(["reset", "send"]);
  });

  it("a click and the submit it causes are one action; Enter in a field is a submit and never navigates", async () => {
    const handed = setup(resolves());
    const form = document.querySelector("form") as HTMLFormElement;
    // fireEvent returns false when the event was cancelled: the form never navigates
    expect(fireEvent.submit(form)).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    await screen.findByText("island is here");
    // the explicit submit had no submitter ("submit"); the click on the submit button recorded "check" and the submit it caused is the same action
    await waitFor(() => {
      expect(handed).toHaveLength(1);
    });
    expect(handed[0]?.initialActions).toEqual(["submit", "check"]);
  });

  it("a submit with no submitter (Enter in a field in some browsers) is the action 'submit'", async () => {
    const handed = setup(resolves());
    fireEvent.submit(document.querySelector("form") as HTMLFormElement);
    await screen.findByText("island is here");
    expect(handed[0]?.initialActions).toEqual(["submit"]);
  });
});

describe("useIslandGate: a failed load", () => {
  it("test_failed_island_load_clears_the_stale_action_and_says_so: the click is answered, a later focus performs nothing, the next click retries", async () => {
    let attempts = 0;
    const load = vi.fn(() => {
      attempts += 1;
      return attempts === 1 ? Promise.reject(new Error("offline")) : Promise.resolve({ default: Island });
    });
    const handed = setup(load);
    const send = screen.getByRole("button", { name: "Send" });
    fireEvent.click(send);
    // the failure is visible and announced in a status line, via messages
    expect(await screen.findByText("Could not load. Try again.")).toBeInTheDocument();
    expect(screen.getAllByRole("status").some((el) => el.textContent === "Could not load. Try again.")).toBe(true);
    expect(screen.queryByText("island is here")).toBeNull();
    // a focus afterwards warms (loads the chunk now) but must NEVER perform the old "send"
    send.focus();
    await settle();
    expect(load).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("island is here")).toBeNull();
    expect(handed).toEqual([]);
    // the next real click retries and performs exactly that click's action
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    await screen.findByText("island is here");
    await waitFor(() => {
      expect(handed).toHaveLength(1);
    });
    expect(handed[0]?.initialActions).toEqual(["reset"]);
  });

  it("a failure clears the line on the retry, and the live region is always in the page", async () => {
    let attempts = 0;
    const load = () => {
      attempts += 1;
      return attempts === 1 ? Promise.reject(new Error("offline")) : Promise.resolve({ default: Island });
    };
    setup(load);
    expect(document.querySelector("[data-island-status]")).not.toBeNull();
    expect(document.querySelector("[data-island-status]")?.textContent).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("Could not load. Try again.");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
      await settle();
    });
    await waitFor(() => {
      expect(screen.queryByText("Could not load. Try again.")).toBeNull();
    });
  });
});

describe("lastModeTap", () => {
  it("the last Live or Replay tap wins, anything else is ignored", () => {
    expect(lastModeTap([])).toBeNull();
    expect(lastModeTap(["send", "reset"])).toBeNull();
    expect(lastModeTap(["demo-live", "send", "demo-replay"])).toBe("replay");
    expect(lastModeTap(["demo-replay", "demo-live"])).toBe("live");
  });
});
