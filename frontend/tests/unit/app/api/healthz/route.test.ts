import { GET } from "@/app/api/healthz/route";

afterEach(() => {
  vi.unstubAllEnvs();
});

it("returns ok with the build version", async () => {
  vi.stubEnv("APP_VERSION", "abc123");
  const res = await GET();
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ status: "ok", version: "abc123" });
});

it("falls back to dev when APP_VERSION is unset", async () => {
  vi.stubEnv("APP_VERSION", undefined);
  const res = await GET();
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ status: "ok", version: "dev" });
});
