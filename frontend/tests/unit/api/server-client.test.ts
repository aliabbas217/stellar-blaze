// @vitest-environment node
import { http, HttpResponse } from "msw/http";
import { headers } from "next/headers";
import { serverApiClient } from "@/api/server-client";
import { server } from "@/mocks/node";

/*
 * serverApiClient() is for Server Components: it calls API_ORIGIN directly (no BFF hop) and carries the incoming
 * request id and, outside production, the mock scenario header.
 */

vi.mock("next/headers", () => ({ headers: vi.fn() }));

const ORIGIN = "http://api.test";

function incoming(init: Record<string, string> = {}): void {
  vi.mocked(headers).mockResolvedValue(new Headers(init));
}

/** Records the headers the upstream sees on GET /api/v1/sites. */
function recordSitesHeaders(): Headers[] {
  const seen: Headers[] = [];
  server.use(
    http.get(`${ORIGIN}/api/v1/sites`, ({ request }) => {
      seen.push(request.headers);
      return HttpResponse.json([]);
    }),
  );
  return seen;
}

beforeEach(() => {
  vi.stubEnv("API_ORIGIN", ORIGIN);
  incoming();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.mocked(headers).mockReset();
});

it("calls API_ORIGIN with typed paths", async () => {
  server.use(http.get(`${ORIGIN}/api/v1/sites`, () => HttpResponse.json([{ id: "s", name: "S", timezone: "Asia/Dubai", synthetic: true }])));

  const { data, response } = await (await serverApiClient()).GET("/api/v1/sites");

  expect(response.status).toBe(200);
  expect(data).toEqual([{ id: "s", name: "S", timezone: "Asia/Dubai", synthetic: true }]);
});

it("throws at call time when API_ORIGIN is unset", async () => {
  vi.stubEnv("API_ORIGIN", undefined);

  await expect(serverApiClient()).rejects.toThrow(/API_ORIGIN/);
});

it("forwards the incoming x-request-id", async () => {
  incoming({ "x-request-id": "in-7" });
  const seen = recordSitesHeaders();

  await (await serverApiClient()).GET("/api/v1/sites");

  expect(seen[0]?.get("x-request-id")).toBe("in-7");
});

it("sends no x-request-id when the page request had none", async () => {
  const seen = recordSitesHeaders();

  await (await serverApiClient()).GET("/api/v1/sites");

  expect(seen).toHaveLength(1);
  expect(seen[0]?.get("x-request-id")).toBeNull();
});

describe("x-sb-mock-scenario", () => {
  it("is forwarded outside production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    incoming({ "x-sb-mock-scenario": "stale" });
    const seen = recordSitesHeaders();

    await (await serverApiClient()).GET("/api/v1/sites");

    expect(seen[0]?.get("x-sb-mock-scenario")).toBe("stale");
  });

  it("is dropped in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    incoming({ "x-sb-mock-scenario": "stale" });
    const seen = recordSitesHeaders();

    await (await serverApiClient()).GET("/api/v1/sites");

    expect(seen[0]?.get("x-sb-mock-scenario")).toBeNull();
  });

  it("is forwarded in production when SB_MOCK_SCENARIOS=1", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SB_MOCK_SCENARIOS", "1");
    incoming({ "x-sb-mock-scenario": "stale" });
    const seen = recordSitesHeaders();

    await (await serverApiClient()).GET("/api/v1/sites");

    expect(seen[0]?.get("x-sb-mock-scenario")).toBe("stale");
  });
});
