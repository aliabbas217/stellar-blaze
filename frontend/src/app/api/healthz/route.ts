export const dynamic = "force-dynamic";

export function GET(): Promise<Response> {
  return Promise.resolve(
    Response.json({ status: "ok", version: process.env.APP_VERSION ?? "dev" }),
  );
}
