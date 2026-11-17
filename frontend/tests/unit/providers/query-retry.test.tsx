import { useMutation, useQuery } from "@tanstack/react-query";
import { act, render } from "@testing-library/react";
import { ApiProblem, networkProblem, UPSTREAM_UNAVAILABLE_TYPE } from "@/api/problem";
import { QueryProvider } from "@/providers/QueryProvider";

/*
 * What the app's QueryClient retries. A read that failed with `upstream-unavailable` is the 502 the BFF returns when its own time limit
 * fired (src/app/api/v1/[...path]/route.ts): it has already waited the whole limit, so a retry doubles the wait before the saved copy
 * or the error state (about 90 s instead of 45 s at the deploy value) for a service that is not answering. Every other failure of a read
 * (a network rejection before the request was sent, a plain 500) keeps the single retry; mutations are never retried.
 * Real QueryProvider, fake timers (TanStack waits about 1 s before the retry).
 */

const KEY = ["retry-probe"];

function problem(status: number, type: string): ApiProblem {
  return new ApiProblem({ type, title: "t", status });
}

function Read({ attempt }: { attempt: () => Promise<never> }) {
  useQuery({ queryKey: KEY, queryFn: attempt });
  return null;
}

function Write({ attempt }: { attempt: () => Promise<never> }) {
  const mutation = useMutation({ mutationFn: attempt });
  return (
    <button
      type="button"
      onClick={() => {
        mutation.mutate(undefined);
      }}
    >
      go
    </button>
  );
}

/** Mounts a read whose every attempt rejects with `failure`, lets the clock run well past the retry delay, and counts the attempts. */
async function attemptsOfRead(failure: unknown): Promise<number> {
  const attempt = vi.fn((): Promise<never> => Promise.reject(failure as Error));
  render(
    <QueryProvider>
      <Read attempt={attempt} />
    </QueryProvider>,
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000);
  });
  return attempt.mock.calls.length;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a read that failed with upstream-unavailable", () => {
  it("is attempted exactly once: the BFF already waited its whole limit", async () => {
    expect(await attemptsOfRead(problem(502, UPSTREAM_UNAVAILABLE_TYPE))).toBe(1);
  });
});

describe("every other transient failure of a read keeps the single retry", () => {
  it("a network rejection before the request was sent (status 0) is attempted twice", async () => {
    expect(await attemptsOfRead(new ApiProblem(networkProblem()))).toBe(2);
  });

  it("a plain 500 is attempted twice", async () => {
    expect(await attemptsOfRead(problem(500, "about:blank"))).toBe(2);
  });

  it("a 502 that is not the BFF's upstream-unavailable problem (a proxy's own) is attempted twice", async () => {
    expect(await attemptsOfRead(problem(502, "about:blank"))).toBe(2);
  });

  it("a thrown value that is not an ApiProblem (an unexpected error) is attempted twice", async () => {
    expect(await attemptsOfRead(new TypeError("boom"))).toBe(2);
  });
});

describe("mutations", () => {
  it("stay unretried, whatever the failure", async () => {
    const attempt = vi.fn((): Promise<never> => Promise.reject(problem(500, "about:blank")));
    const { getByRole } = render(
      <QueryProvider>
        <Write attempt={attempt} />
      </QueryProvider>,
    );
    await act(async () => {
      getByRole("button").click();
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(attempt).toHaveBeenCalledTimes(1);
  });
});
