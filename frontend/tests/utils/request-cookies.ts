import type { cookies } from "next/headers";
import { NextRequest } from "next/server";

type RequestCookies = Awaited<ReturnType<typeof cookies>>;

/** The cookie store of a request that carries `header` (e.g. "NEXT_LOCALE=ur"), parsed by Next.js itself. */
export function requestCookies(header?: string): RequestCookies {
  const request = new NextRequest("http://localhost/", header === undefined ? {} : { headers: { cookie: header } });
  // Next's own ReadonlyRequestCookies is a type-level view of the same object; only `get` is read in these tests.
  return request.cookies as unknown as RequestCookies;
}
