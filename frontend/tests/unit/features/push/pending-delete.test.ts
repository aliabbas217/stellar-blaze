import { http, HttpResponse } from "msw/http";
import {
  deleteRegistration,
  forgetPendingDelete,
  MAX_PENDING_DELETES,
  PASS_TIMEOUT_MS,
  PENDING_DELETE_KEY,
  readPendingDeletes,
  rememberPendingDelete,
  retryPendingDeletes,
} from "@/features/push/pending-delete";
import { server } from "@/mocks/node";

/*
 * A registration the API has not confirmed deleting (ruling R32). The worker took their data back, but the DELETE could
 * not be made or answered: the phone keeps the registration's opaque id, and nothing else, until the API says it is
 * gone. The id says nothing about the worker; the endpoint, the site and the profile are not kept.
 */

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the pending list", () => {
  it("is empty on a phone that never had one", () => {
    expect(readPendingDeletes()).toEqual([]);
  });

  it("keeps the id and nothing else, under sb-push-pending-delete-v1", () => {
    rememberPendingDelete("sub-1");
    expect(PENDING_DELETE_KEY).toBe("sb-push-pending-delete-v1");
    expect(localStorage.getItem(PENDING_DELETE_KEY)).toBe(JSON.stringify(["sub-1"]));
    expect(readPendingDeletes()).toEqual(["sub-1"]);
  });

  it("keeps several, oldest first, each once", () => {
    rememberPendingDelete("sub-1");
    rememberPendingDelete("sub-2");
    rememberPendingDelete("sub-1");
    expect(readPendingDeletes()).toEqual(["sub-1", "sub-2"]);
  });

  it(`keeps at most ${String(MAX_PENDING_DELETES)}: the oldest is let go, because the API prunes dead endpoints anyway`, () => {
    for (let n = 1; n <= MAX_PENDING_DELETES + 2; n += 1) rememberPendingDelete(`sub-${String(n)}`);
    const kept = readPendingDeletes();
    expect(kept).toHaveLength(MAX_PENDING_DELETES);
    expect(kept[0]).toBe("sub-3");
    expect(kept.at(-1)).toBe(`sub-${String(MAX_PENDING_DELETES + 2)}`);
  });

  it("forgets one id and removes the key when none is left", () => {
    rememberPendingDelete("sub-1");
    rememberPendingDelete("sub-2");
    forgetPendingDelete("sub-1");
    expect(readPendingDeletes()).toEqual(["sub-2"]);
    forgetPendingDelete("sub-2");
    expect(localStorage.getItem(PENDING_DELETE_KEY)).toBeNull();
  });

  it("forgetting an id that is not there changes nothing", () => {
    rememberPendingDelete("sub-1");
    forgetPendingDelete("sub-9");
    expect(readPendingDeletes()).toEqual(["sub-1"]);
  });

  it.each([
    ["corrupt JSON", "{not json"],
    ["an object", JSON.stringify({ id: "sub-1" })],
    ["a string", JSON.stringify("sub-1")],
    ["null", "null"],
  ])("reads %s as an empty list, without throwing", (_name, stored) => {
    localStorage.setItem(PENDING_DELETE_KEY, stored);
    expect(readPendingDeletes()).toEqual([]);
  });

  it("drops entries that are not ids", () => {
    localStorage.setItem(PENDING_DELETE_KEY, JSON.stringify(["sub-1", "", 7, null, { id: "x" }, "sub-2"]));
    expect(readPendingDeletes()).toEqual(["sub-1", "sub-2"]);
  });

  it("does not throw when localStorage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    expect(() => {
      rememberPendingDelete("sub-1");
      forgetPendingDelete("sub-1");
    }).not.toThrow();
    expect(readPendingDeletes()).toEqual([]);
  });
});

function answerDelete(status: number) {
  server.use(
    http.delete("*/api/v1/push/subscriptions/:id", () =>
      status < 300
        ? new HttpResponse(null, { status })
        : HttpResponse.json({ type: "about:blank", title: "x", status }, { status, headers: { "content-type": "application/problem+json" } }),
    ),
  );
}

describe("deleteRegistration: when the API no longer has the registration", () => {
  it.each([[200], [204]])("true when the API deleted it (%i)", async (status) => {
    answerDelete(status);
    expect(await deleteRegistration("sub-1")).toBe(true);
  });

  it.each([[404], [410]])("true when the API does not know it (%i): it is gone", async (status) => {
    answerDelete(status);
    expect(await deleteRegistration("sub-1")).toBe(true);
  });

  it.each([[400], [401], [403], [408], [409], [429], [500], [502], [503]])(
    "false for %i: that is not an answer about the registration, so it stays",
    async (status) => {
      answerDelete(status);
      expect(await deleteRegistration("sub-1")).toBe(false);
    },
  );

  it("false when the request never reaches the API (offline)", async () => {
    server.use(http.delete("*/api/v1/push/subscriptions/:id", () => HttpResponse.error()));
    expect(await deleteRegistration("sub-1")).toBe(false);
  });
});

describe("retryPendingDeletes", () => {
  it("does nothing, and asks nothing, when the list is empty", async () => {
    const remove = vi.fn(() => Promise.resolve(true));
    expect(await retryPendingDeletes(remove)).toEqual([]);
    expect(remove).not.toHaveBeenCalled();
  });

  it("tries every id and forgets the ones the API confirmed", async () => {
    rememberPendingDelete("sub-1");
    rememberPendingDelete("sub-2");
    rememberPendingDelete("sub-3");
    const remove = vi.fn((id: string) => Promise.resolve(id !== "sub-2"));

    const left = await retryPendingDeletes(remove);

    expect(remove.mock.calls.map(([id]) => id)).toEqual(["sub-1", "sub-2", "sub-3"]);
    expect(left).toEqual(["sub-2"]);
    expect(readPendingDeletes()).toEqual(["sub-2"]);
  });

  it("keeps an id when its delete throws, and still tries the others", async () => {
    rememberPendingDelete("sub-1");
    rememberPendingDelete("sub-2");
    const remove = vi.fn((id: string) => (id === "sub-1" ? Promise.reject(new Error("boom")) : Promise.resolve(true)));

    expect(await retryPendingDeletes(remove)).toEqual(["sub-1"]);
  });

  it("leaves an id that was remembered while it ran", async () => {
    rememberPendingDelete("sub-1");
    const remove = vi.fn((id: string) => {
      if (id === "sub-1") rememberPendingDelete("sub-2");
      return Promise.resolve(true);
    });
    expect(await retryPendingDeletes(remove)).toEqual(["sub-2"]);
  });

  it("runs one retry at a time, and the second does not send a DELETE the first confirmed", async () => {
    rememberPendingDelete("sub-1");
    let finish: (gone: boolean) => void = () => undefined;
    const remove = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );

    const first = retryPendingDeletes(remove);
    const second = retryPendingDeletes(remove);
    await vi.waitFor(() => {
      expect(remove).toHaveBeenCalledTimes(1);
    });
    finish(true);

    expect(await first).toEqual(await second);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("does not let one DELETE that never answers block every later retry", async () => {
    vi.useFakeTimers();
    try {
      rememberPendingDelete("sub-1");
      const stuck = vi.fn(() => new Promise<boolean>(() => undefined));
      void retryPendingDeletes(stuck);
      const later = vi.fn(() => Promise.resolve(true));
      const second = retryPendingDeletes(later);

      await vi.advanceTimersByTimeAsync(PASS_TIMEOUT_MS);

      expect(await second).toEqual([]);
      expect(later).toHaveBeenCalledExactlyOnceWith("sub-1");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses the real DELETE by default: a 204 clears the id, a 502 keeps it", async () => {
    rememberPendingDelete("sub-1");
    answerDelete(502);
    expect(await retryPendingDeletes()).toEqual(["sub-1"]);

    answerDelete(204);
    expect(await retryPendingDeletes()).toEqual([]);
    expect(localStorage.getItem(PENDING_DELETE_KEY)).toBeNull();
  });
});
