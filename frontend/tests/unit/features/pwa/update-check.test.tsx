import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw/http";
import { NextIntlClientProvider } from "next-intl";
import { postStop, clearStopMutation } from "@/api/queries";
import { server } from "@/mocks/node";
import { LocalePrefs } from "@/features/pwa/LocalePrefs";
import { checkForNewWorkerOnce, resetUpdateCheckForTest } from "@/features/pwa/update-check";
import { trackSafetyFlight } from "@/lib/safety-flight";

/*
 * On app load the page asks the browser to look for a newer service worker, ONCE per page load (a returning visitor keeps the old
 * worker until the browser's own check, up to about 24 h: task-wk-report.md). Never while a Stop (or its undo) is in flight: the new
 * worker takes over at once (skipWaiting + clientsClaim), and a safety write must not share a moment with a worker swap. It never
 * writes to the console and never rejects: an offline update check is normal.
 */

type Registration = { update: () => Promise<void> };

function stubServiceWorker(getRegistration: () => Promise<Registration | undefined>): void {
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { getRegistration } });
}

function removeServiceWorker(): void {
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: undefined });
}

function mountPrefs(locale: "en" | "ar" = "en") {
  return render(
    <NextIntlClientProvider locale={locale} messages={{}}>
      <LocalePrefs />
    </NextIntlClientProvider>,
  );
}

const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown): void => {
  unhandled.push(reason);
};

beforeEach(() => {
  resetUpdateCheckForTest();
  unhandled.length = 0;
  process.on("unhandledRejection", onUnhandled);
});

afterEach(() => {
  process.off("unhandledRejection", onUnhandled);
  removeServiceWorker();
  vi.restoreAllMocks();
});

async function settle(): Promise<void> {
  // Let every promise continuation run, then a macrotask so an unhandled rejection would have been reported.
  await new Promise((resolve) => setTimeout(resolve, 20));
}

describe("the service worker update check on page load", () => {
  it("calls registration.update() once on mount, and not again on a re-render, a remount or a locale change", async () => {
    const update = vi.fn(() => Promise.resolve());
    stubServiceWorker(() => Promise.resolve({ update }));
    const view = mountPrefs("en");
    await settle();
    expect(update).toHaveBeenCalledTimes(1);
    view.rerender(
      <NextIntlClientProvider locale="en" messages={{}}>
        <LocalePrefs />
      </NextIntlClientProvider>,
    );
    view.unmount();
    mountPrefs("ar");
    await settle();
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("does nothing, and does not throw, where there is no service worker API", async () => {
    removeServiceWorker();
    expect(() => mountPrefs()).not.toThrow();
    await settle();
    expect(unhandled).toEqual([]);
  });

  it("does nothing when there is no registration yet", async () => {
    stubServiceWorker(() => Promise.resolve(undefined));
    expect(() => mountPrefs()).not.toThrow();
    await settle();
    expect(unhandled).toEqual([]);
  });

  it("swallows a getRegistration() rejection: no unhandled rejection, nothing on the console", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    stubServiceWorker(() => Promise.reject(new Error("blocked")));
    mountPrefs();
    await settle();
    expect(unhandled).toEqual([]);
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("swallows an update() rejection (the check offline): no unhandled rejection, nothing on the console", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const update = vi.fn(() => Promise.reject(new TypeError("Failed to update a ServiceWorker: Failed to fetch")));
    stubServiceWorker(() => Promise.resolve({ update }));
    mountPrefs();
    await settle();
    expect(update).toHaveBeenCalledTimes(1);
    expect(unhandled).toEqual([]);
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("swallows a synchronous throw from getRegistration()", async () => {
    stubServiceWorker(() => {
      throw new Error("sync");
    });
    expect(() => mountPrefs()).not.toThrow();
    await settle();
    expect(unhandled).toEqual([]);
  });

  describe("never while a Stop is in flight", () => {
    it("waits for the Stop request (and an undo) to settle, then checks once", async () => {
      const update = vi.fn(() => Promise.resolve());
      stubServiceWorker(() => Promise.resolve({ update }));
      let finishStop: (value: string) => void = () => undefined;
      const stop = trackSafetyFlight(new Promise<string>((resolve) => (finishStop = resolve)));
      let finishUndo: (value: string) => void = () => undefined;
      const undo = trackSafetyFlight(new Promise<string>((resolve) => (finishUndo = resolve)));
      checkForNewWorkerOnce();
      await settle();
      expect(update).not.toHaveBeenCalled();
      finishStop("stop");
      await stop;
      await settle();
      expect(update, "one flight is still open").not.toHaveBeenCalled();
      finishUndo("undo");
      await undo;
      await settle();
      expect(update).toHaveBeenCalledTimes(1);
      checkForNewWorkerOnce();
      await settle();
      expect(update, "once per page load").toHaveBeenCalledTimes(1);
    });

    it("a flight that FAILS also ends: the check is not held for ever by a Stop that was refused", async () => {
      const update = vi.fn(() => Promise.resolve());
      stubServiceWorker(() => Promise.resolve({ update }));
      const stop = trackSafetyFlight(Promise.reject(new Error("refused")));
      stop.catch(() => undefined);
      checkForNewWorkerOnce();
      await settle();
      expect(update).toHaveBeenCalledTimes(1);
    });

    it("the real Stop request and the real undo are counted: the check waits for each, over the wire", async () => {
      const update = vi.fn(() => Promise.resolve());
      stubServiceWorker(() => Promise.resolve({ update }));
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => (release = resolve));
      server.use(
        http.post("*/api/v1/crews/:crew_id/stops", async () => {
          await gate;
          return HttpResponse.json({ stop_id: "s1" }, { status: 500 });
        }),
        http.delete("*/api/v1/crews/:crew_id/stops/:stop_id", async () => {
          await gate;
          return new HttpResponse(null, { status: 204 });
        }),
      );
      const stop = postStop("crew-a", { reason_code: "heat" }).catch(() => undefined);
      const undo = clearStopMutation("crew-a").mutationFn?.("s1", {} as never).catch(() => undefined);
      checkForNewWorkerOnce();
      await settle();
      expect(update).not.toHaveBeenCalled();
      release();
      await stop;
      await undo;
      await settle();
      expect(update).toHaveBeenCalledTimes(1);
    });

    it("no flight: the check runs at once", async () => {
      const update = vi.fn(() => Promise.resolve());
      stubServiceWorker(() => Promise.resolve({ update }));
      checkForNewWorkerOnce();
      await settle();
      expect(update).toHaveBeenCalledTimes(1);
    });
  });
});
