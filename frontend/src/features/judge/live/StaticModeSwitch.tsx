"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useSyncExternalStore } from "react";
import { DemoModeSwitch } from "@/components/shell/DemoModeSwitch";
import { DEMO_PARAM, parseDemoMode, type DemoMode } from "@/features/demo/constants";
import { DEMO_STORAGE_KEY } from "@/lib/sun/theme-storage";

/*
 * The mode switch of a server-rendered judge page (`GovernanceStatic`, `TryStatic`), before its island has loaded. It shows the
 * mode the demo context WOULD hold: `?demo=` first, then the visitor's stored choice, then Replay (what `DemoProvider` reads on
 * mount, in the same order), so the pressed state never changes when the island takes over. It writes nothing and reads no API:
 * a tap is an island action (`data-island-action="demo-<mode>"`) and the island applies it. `useSearchParams` needs its own
 * Suspense boundary on a statically rendered page; the fallback is the Replay switch the server already drew.
 */

function subscribeToStorage(notify: () => void): () => void {
  window.addEventListener("storage", notify);
  return () => {
    window.removeEventListener("storage", notify);
  };
}

function readStored(): DemoMode | null {
  try {
    const raw = window.localStorage.getItem(DEMO_STORAGE_KEY);
    return raw === "live" || raw === "replay" ? raw : null;
  } catch {
    // Blocked storage: Replay.
    return null;
  }
}

function Reading() {
  const params = useSearchParams();
  let fromUrl: DemoMode | null = null;
  try {
    fromUrl = parseDemoMode(params.get(DEMO_PARAM));
  } catch {
    // Absent or not a mode: not the URL's choice.
  }
  // The stored choice is external state: the server (and the hydrating render) say "none", the browser then says what it holds.
  const stored = useSyncExternalStore(subscribeToStorage, readStored, () => null);
  return <DemoModeSwitch value={fromUrl ?? stored ?? "replay"} liveUnavailable={false} />;
}

export function StaticModeSwitch() {
  return (
    <Suspense fallback={<DemoModeSwitch value="replay" liveUnavailable={false} />}>
      <Reading />
    </Suspense>
  );
}
