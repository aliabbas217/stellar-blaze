import { MutationObserver, QueryClient, onlineManager } from "@tanstack/react-query";
import { http, HttpResponse } from "msw/http";
import type { Middleware } from "openapi-fetch";
import { apiClient } from "@/api/client";
import { ApiProblem } from "@/api/problem";
import {
  clearStopMutation,
  crewDayPlanQueryOptions,
  crewTimelineQueryOptions,
  crewsQueryOptions,
  dataRequestMutation,
  resetDemoMutation,
  signOffMutation,
  stopMutation,
  transparencyLogQueryOptions,
  validatePlanMutation,
} from "@/api/queries";
import { queryKeys } from "@/api/query-keys";
import { resetDemoStateHard } from "@/mocks/fixtures";
import { server } from "@/mocks/node";

/*
 * The typed query options of the F2 operations, run against the MSW handlers in jsdom, through the same-origin client
 * the app uses. The mock answers 401 on an employer route without a bearer token; in the app the BFF adds the demo
 * token, so the tests that need it register a client middleware that stands in for the BFF.
 */

const DEMO_SITE = "site-demo-mussafah";

function newClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

/** Runs a mutation to its result, the way a component's `useMutation` would. */
function mutate<TData, TVariables>(
  client: QueryClient,
  options: ConstructorParameters<typeof MutationObserver<TData, ApiProblem, TVariables>>[1],
  variables: TVariables,
): Promise<TData> {
  return new MutationObserver<TData, ApiProblem, TVariables>(client, options).mutate(variables);
}

const bff: Middleware = {
  onRequest({ request }) {
    request.headers.set("authorization", "Bearer demo-token");
    return request;
  },
};

function asBff(): void {
  apiClient.use(bff);
}

beforeEach(() => {
  resetDemoStateHard();
});

afterEach(() => {
  apiClient.eject(bff);
  onlineManager.setOnline(true);
});

describe("query keys", () => {
  it("keeps the keys the worker Today screen already uses", () => {
    expect(queryKeys.riskPolicy()).toEqual(["risk-policy"]);
    expect(queryKeys.today(DEMO_SITE)).toEqual(["today", DEMO_SITE]);
  });

  it("gives the default date its own key", () => {
    expect(queryKeys.crewTimeline("crew-b")).toEqual(["crew-timeline", "crew-b", null]);
    expect(queryKeys.crewTimeline("crew-b", "2026-09-03")).toEqual(["crew-timeline", "crew-b", "2026-09-03"]);
    expect(queryKeys.crewDayPlan("crew-b")).not.toEqual(queryKeys.crewDayPlan("crew-b", "2026-09-03"));
  });
});

describe("read options", () => {
  it("none of them is offlineFirst: only the two allow-listed reads are", () => {
    const options = [
      crewsQueryOptions(DEMO_SITE),
      crewTimelineQueryOptions("crew-b"),
      crewDayPlanQueryOptions("crew-b"),
      transparencyLogQueryOptions(DEMO_SITE),
    ];

    expect(options.map((option) => option.networkMode)).toEqual([undefined, undefined, undefined, undefined]);
  });

  it("crews: the four crews of the demo site", async () => {
    const crews = await newClient().query(crewsQueryOptions(DEMO_SITE));

    expect(crews.map((crew) => crew.id)).toEqual(["crew-a", "crew-b", "crew-c", "crew-d"]);
  });

  it("crew timeline: with and without a date, never sending an empty date parameter", async () => {
    const seen: (string | null)[] = [];
    server.use(
      http.get("*/api/v1/crews/:crew_id/timeline", ({ request }) => {
        seen.push(new URL(request.url).searchParams.get("date"));
        return undefined;
      }),
    );

    expect((await newClient().query(crewTimelineQueryOptions("crew-b"))).date).toBe("2026-09-03");
    expect((await newClient().query(crewTimelineQueryOptions("crew-b", "2026-11-11"))).ban_window.active_on_date).toBe(false);
    expect(seen).toEqual([null, "2026-11-11"]);
  });

  it("day plan: an unauthorized call is an ApiProblem with its status and request id", async () => {
    const failure = await newClient()
      .query(crewDayPlanQueryOptions("crew-b"))
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiProblem);
    expect((failure as ApiProblem).problem).toMatchObject({ status: 401, request_id: "mock-req-1" });
  });

  it("day plan and transparency log through the BFF stand-in", async () => {
    asBff();
    const client = newClient();

    const plan = await client.query(crewDayPlanQueryOptions("crew-b"));
    const log = await client.query(transparencyLogQueryOptions(DEMO_SITE));

    expect(plan.validator.passed).toBe(true);
    expect(log).toEqual({ site_id: DEMO_SITE, entries: [] });
  });

  it("an unreachable API is a network ApiProblem, not an unhandled rejection", async () => {
    server.use(http.get("*/api/v1/sites/:site_id/crews", () => HttpResponse.error()));

    const failure = await newClient()
      .query(crewsQueryOptions(DEMO_SITE))
      .catch((error: unknown) => error);

    expect((failure as ApiProblem).problem.status).toBe(0);
  });
});

describe("write options", () => {
  it("validate plan: returns the validator's findings for a typed roster", async () => {
    const result = await mutate(newClient(), validatePlanMutation(), {
      site_id: DEMO_SITE,
      date: "2026-09-03",
      crew: { workload: "heavy", headcount: 20, acclimatised: true, days_per_week: 6 },
      roster_text: "06:00-12:30 work\n15:00-17:00 work",
      segments: null,
    });

    expect(result.validator.passed).toBe(false);
  });

  it("data request: always ends in the 403 refusal as an ApiProblem, and the log records it", async () => {
    asBff();
    const client = newClient();

    const failure = await mutate(client, dataRequestMutation(DEMO_SITE), { subject: "worker", data_class: "health", worker_ref: "someone" }).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(ApiProblem);
    expect((failure as ApiProblem).problem).toMatchObject({ status: 403, type: "urn:stellar-blaze:problem:individual-data-refused" });
    expect((await client.query(transparencyLogQueryOptions(DEMO_SITE))).entries).toHaveLength(1);
  });

  it("stop, sign-off 409 then 200, clear the stop, then reset: the sequence the supervisor screens run", async () => {
    asBff();
    const client = newClient();

    const stop = await mutate(client, stopMutation("crew-b"), { reason_code: "heat" });
    expect(stop.cleared_at).toBeNull();

    const refused = await mutate(client, signOffMutation("crew-b"), { acknowledged_items: [], deviation_reason_code: null }).catch((error: unknown) => error);
    expect((refused as ApiProblem).problem).toMatchObject({ status: 409, type: "urn:stellar-blaze:problem:review-required" });

    const plan = await client.query(crewDayPlanQueryOptions("crew-b"));
    const signed = await mutate(client, signOffMutation("crew-b"), {
      acknowledged_items: plan.ack_items.map((item) => item.id),
      deviation_reason_code: null,
    });
    expect(signed.signoff_state).toBe("signed");

    await mutate(client, clearStopMutation("crew-b"), stop.id);
    const reset = await mutate(client, resetDemoMutation(DEMO_SITE), undefined);
    expect(reset).toMatchObject({ epoch_id: 2, previous_epoch_id: 1 });
    expect((await client.query({ ...crewDayPlanQueryOptions("crew-b"), staleTime: 0 })).signoff_state).toBe("unsigned");
  });

  it("a stop is a plain POST: it reads no day plan and no sign-off first", async () => {
    asBff();
    const seen: string[] = [];
    server.use(
      http.all("*/api/v1/*", ({ request }) => {
        seen.push(`${request.method} ${new URL(request.url).pathname}`);
        return undefined;
      }),
    );

    await mutate(newClient(), stopMutation("crew-b"), { reason_code: "worker_unwell" });

    expect(seen).toEqual(["POST /api/v1/crews/crew-b/stops"]);
  });

  it.each([
    ["stopMutation", () => stopMutation("crew-b")],
    ["clearStopMutation", () => clearStopMutation("crew-b")],
    ["signOffMutation", () => signOffMutation("crew-b")],
    ["dataRequestMutation", () => dataRequestMutation(DEMO_SITE)],
  ] as const)("%s sets networkMode always, so it is not held back while the device looks offline", (_name, options) => {
    expect(options().networkMode).toBe("always");
  });

  it("a stop made while the device is offline fails at once as a network ApiProblem, and is not queued to fire on reconnect", async () => {
    asBff();
    const seen: string[] = [];
    server.use(
      http.all("*/api/v1/*", ({ request }) => {
        seen.push(request.method);
        return HttpResponse.error();
      }),
    );
    onlineManager.setOnline(false);
    const client = newClient();

    const failure = await Promise.race([
      mutate(client, stopMutation("crew-b"), { reason_code: "heat" }).catch((error: unknown) => error),
      new Promise((resolve) => {
        setTimeout(() => {
          resolve("still paused");
        }, 1000);
      }),
    ]);

    expect(failure).toBeInstanceOf(ApiProblem);
    expect((failure as ApiProblem).problem.status).toBe(0);
    expect(seen).toEqual(["POST"]);
    // Coming back online sends nothing more: the failed stop is not a pending one.
    onlineManager.setOnline(true);
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
    expect(seen).toEqual(["POST"]);
  });

  it("a data request made while the device is offline fails at once as a network ApiProblem and is not queued", async () => {
    asBff();
    const seen: string[] = [];
    server.use(
      http.all("*/api/v1/*", ({ request }) => {
        seen.push(request.method);
        return HttpResponse.error();
      }),
    );
    onlineManager.setOnline(false);
    const failure = await Promise.race([
      mutate(newClient(), dataRequestMutation(DEMO_SITE), { subject: "worker", data_class: "health", worker_ref: "x" }).catch((error: unknown) => error),
      new Promise((resolve) => {
        setTimeout(() => {
          resolve("still paused");
        }, 1000);
      }),
    ]);
    expect(failure).toBeInstanceOf(ApiProblem);
    expect((failure as ApiProblem).problem.status).toBe(0);
    onlineManager.setOnline(true);
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
    expect(seen).toEqual(["POST"]);
  });

  it("the sign-off mutation and the stop mutation take their own mutation keys, so one cannot pause the other", () => {
    expect(stopMutation("crew-b").mutationKey).toEqual(["crew-stop", "crew-b"]);
    expect(signOffMutation("crew-b", "2026-09-03").mutationKey).toEqual(["sign-off", "crew-b", "2026-09-03"]);
  });
});
