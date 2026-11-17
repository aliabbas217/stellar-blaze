"use client";

import { useCallback, useEffect, useState } from "react";
import { apiClient } from "@/api/client";
import { ApiProblem, networkProblem } from "@/api/problem";
import type { components } from "@/api/schema";
import { call, isAbortError } from "@/api/result";

/*
 * The two public reads of the join page, with no query client (redesign S6a). The page needs exactly two things from the API, once each, and
 * has no cache to share: the site list (`GET /api/v1/sites`) and one site's crews (`GET /api/v1/sites/{id}/crews`). Both are public (no
 * credential, the BFF's allow-list is untouched). TanStack Query is the app's tool for data that lives on a screen, but on this route it
 * costs about 19 KB gzip (the observer, the query core and the mutation cache that its provider carries) against a route budget of
 * 174,080 B that the page exceeds by 2.8 KB with it and meets without it, so the join page reads with a plain effect: abortable, one
 * attempt (the error state has a retry), and the failure kept as an `ApiProblem` so the request id reaches the error state.
 *
 * Not shared with `sitesQueryOptions` / `crewsQueryOptions` (src/api): those return react-query options, and importing them would
 * bring the client back. The endpoints and the schema types are the same; if an endpoint moves, `pnpm api:check` and the type check say so.
 */

type Site = components["schemas"]["Site"];
type Crew = components["schemas"]["Crew"];

export interface Read<T> {
  /** Undefined while loading and after a failure. */
  readonly data: T | undefined;
  /** The failure of the last attempt, with the request id when the API gave one; null while loading and on success. */
  readonly error: ApiProblem | null;
  /** Tries again: back to loading, then the answer. */
  readonly refetch: () => void;
}

async function settle<T>(request: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T> {
  const result = await call(request);
  if (!result.ok) throw new ApiProblem(result.problem);
  return result.data;
}

interface Outcome<T> {
  readonly key: string;
  readonly attempt: number;
  readonly data?: T;
  readonly error?: ApiProblem;
}

/** Runs `load` when `key` changes or `refetch` is called, unless `enabled` is false. An outcome for an older key or attempt is never shown. */
function useRead<T>(key: string, enabled: boolean, load: (signal: AbortSignal) => Promise<T>): Read<T> {
  const [attempt, setAttempt] = useState(0);
  const [outcome, setOutcome] = useState<Outcome<T> | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    load(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setOutcome({ key, attempt, data });
      },
      (failure: unknown) => {
        if (controller.signal.aborted || isAbortError(failure)) return;
        // `settle` throws ApiProblem only; anything else (a bug in a handler, a stale chunk) is still a failed read for the worker.
        setOutcome({ key, attempt, error: failure instanceof ApiProblem ? failure : new ApiProblem(networkProblem()) });
      },
    );
    return () => {
      controller.abort();
    };
  }, [key, attempt, enabled, load]);

  const current = outcome !== null && outcome.key === key && outcome.attempt === attempt ? outcome : null;
  const refetch = useCallback(() => {
    setAttempt((value) => value + 1);
  }, []);
  return { data: current?.data, error: current?.error ?? null, refetch };
}

const loadSites = (signal: AbortSignal): Promise<Site[]> => settle(apiClient.GET("/api/v1/sites", { signal }));

/** `list_sites`. */
export function useSites(): Read<Site[]> {
  return useRead("sites", true, loadSites);
}

/** `list_site_crews` for `siteId`; nothing is asked while `enabled` is false (the site is not known to exist yet). */
export function useSiteCrews(siteId: string, enabled: boolean): Read<Crew[]> {
  const load = useCallback(
    (signal: AbortSignal): Promise<Crew[]> => settle(apiClient.GET("/api/v1/sites/{site_id}/crews", { params: { path: { site_id: siteId } }, signal })),
    [siteId],
  );
  return useRead(`crews:${siteId}`, enabled, load);
}
