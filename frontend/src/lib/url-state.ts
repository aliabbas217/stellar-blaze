"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import { usePathname, useRouter } from "@/i18n/navigation";

/*
 * URL state (F2 ruling: not nuqs, the worker route family has no bundle room for it). A filter, the demo mode, the
 * replay time and the commute slider live in the query string so a link reproduces the screen. Reading is Next's
 * useSearchParams; writing is router.replace with scroll: false, so a tap neither jumps the page nor fills the history.
 *
 * `useSearchParams` makes the nearest <Suspense> boundary the unit of client-only rendering on a statically rendered
 * page: a component that calls this hook belongs in its own small boundary, never around the page.
 */

type Param = string | number | boolean | null;

/**
 * The query parameter `key` as a `T`, and a setter that writes it. `parse` turns the raw value (`null` when the
 * parameter is absent) into a `T` and may throw for a value it does not accept: a bad or missing value reads as
 * `fallback`. Setting `fallback` (or `null`) removes the parameter, so the default URL stays clean. Other parameters
 * and the hash are kept.
 */
export function useUrlParam<T extends Param>(
  key: string,
  parse: (raw: string | null) => T,
  fallback: T,
): [T, (next: T) => void] {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const raw = searchParams.get(key);

  const value = useMemo((): T => {
    try {
      return parse(raw);
    } catch {
      return fallback;
    }
  }, [raw, parse, fallback]);

  const current = searchParams.toString();
  const set = useCallback(
    (next: T) => {
      const query = new URLSearchParams(current);
      if (next === null || next === fallback) query.delete(key);
      else query.set(key, String(next));
      const search = query.toString();
      const hash = typeof window === "undefined" ? "" : window.location.hash;
      router.replace(`${pathname}${search === "" ? "" : `?${search}`}${hash}`, { scroll: false });
    },
    [current, fallback, key, pathname, router],
  );

  return [value, set];
}
