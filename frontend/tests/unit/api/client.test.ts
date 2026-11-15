import { http, HttpResponse } from "msw/http";
import { apiClient } from "@/api/client";
import { call } from "@/api/result";
import { server } from "@/mocks/node";

/*
 * The browser client is same-origin (baseUrl ""). These tests run in jsdom, which has a page origin like a browser,
 * and they use the singleton exactly as the app does: created at import, before any test body runs.
 */

it("reaches the mock API through a same-origin relative path", async () => {
  const result = await call(apiClient.GET("/api/v1/sites"));

  expect(result.ok).toBe(true);
  if (result.ok) expect(result.data.map((site) => site.id)).toEqual(["site-demo-mussafah", "site-demo-empty"]);
});

it("substitutes path and query parameters", async () => {
  const result = await call(apiClient.GET("/api/v1/crews/{crew_id}/timeline", { params: { path: { crew_id: "crew-a" }, query: { date: "2026-11-11" } } }));

  expect(result.ok).toBe(true);
  if (result.ok) expect(result.data).toMatchObject({ crew_id: "crew-a", date: "2026-11-11" });
});

it("posts a JSON body and gets the 201 body back", async () => {
  const result = await call(
    apiClient.POST("/api/v1/push/subscriptions", {
      body: {
        subscription: { endpoint: "https://fcm.googleapis.com/fcm/send/abc", expirationTime: null, keys: { p256dh: "k", auth: "a" } },
        site_id: "site-demo-mussafah",
        crew_id: null,
      },
    }),
  );

  expect(result).toEqual({ ok: true, data: { id: "sub-mock-1" } });
});

it("turns a problem+json response into a problem with its request id", async () => {
  const result = await call(apiClient.GET("/api/v1/sites", { headers: { "x-sb-mock-scenario": "error" } }));

  expect(result).toMatchObject({ ok: false, problem: { status: 500, request_id: "mock-req-1" } });
});

it("settles a 204 as ok", async () => {
  const result = await call(apiClient.DELETE("/api/v1/push/subscriptions/{subscription_id}", { params: { path: { subscription_id: "sub-mock-1" } } }));

  expect(result.ok).toBe(true);
});

it("reports a dropped connection as a network problem instead of rejecting", async () => {
  server.use(http.get("*/api/v1/risk-policy", () => HttpResponse.error()));

  const result = await call(apiClient.GET("/api/v1/risk-policy"));

  expect(result).toMatchObject({ ok: false, problem: { status: 0, type: "urn:stellar-blaze:problem:network-error" } });
});
