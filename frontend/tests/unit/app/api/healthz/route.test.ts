import { GET } from "@/app/api/healthz/route";

it("returns ok with the build version", async () => {
  process.env.APP_VERSION = "abc123";
  const res = await GET();
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ status: "ok", version: "abc123" });
});
