import { solarElevationDeg, UAE_CENTROID } from "@/lib/sun/solar";
import { THEME_COLORS } from "@/lib/sun/theme-colors";

/** localStorage key of the sun override: JSON `{ theme: "sun" | "night", until: epoch ms }`, written by SunToggle. */
export const THEME_STORAGE_KEY = "sb-theme";

/**
 * localStorage key of the demo mode (`"replay"` or `"live"`). Task 3's DemoProvider owns it; the script only reads it.
 * Absent means replay, the default.
 */
export const DEMO_STORAGE_KEY = "sb-demo";

export type ThemeName = "sun" | "night";

/** What SunToggle stores: the chosen theme and the instant it stops applying (the next local midnight). */
export interface ThemeOverride {
  readonly theme: ThemeName;
  readonly until: number;
}

/** The first instant of the next local day: an override lasts "until the next local midnight" (DESIGN.md section 6). */
export function nextLocalMidnight(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
}

/** The field paths, `/<locale>/worker` and `/<locale>/supervisor` with anything below them. HSE, judge and admin never match. */
const FIELD_PATH = String.raw`^\/[a-z]{2}\/(?:worker|supervisor)(?:\/|$)`;

/**
 * Inline script for `<head>`, run before first paint so sun mode never flashes night. On a field path only, it sets
 * `data-theme="sun"` on <html>, deciding in this order:
 *   1. an unexpired `{theme, until}` override in localStorage["sb-theme"] (sun sets it, night leaves night);
 *   2. `prefers-contrast: more`;
 *   3. replay mode (the default, localStorage["sb-demo"] is not "live"): the replay moment is daytime by construction
 *      (11:10 on a September day), so sun mode is assumed whatever the real clock says;
 *   4. live mode: the sun is above the horizon at the UAE centroid by the device clock (no sensor, no permission,
 *      no geolocation: DESIGN.md section 6).
 * It also moves <meta name="theme-color"> to the sun colour. Desk routes are night only and are never touched. Every
 * storage read is guarded (private windows and blocked site data throw) and a failure just means "no override".
 *
 * The solar function is embedded from src/lib/sun/solar.ts through Function.prototype.toString, so there is one
 * implementation; solar.ts says why it must stay self-contained.
 *
 * It runs once per full page load. A client-side navigation between a desk route and a field route does not re-run
 * it: the field shell (Task 3) must re-apply it on a route change.
 */
export const sunScript = `(function(){try{
var solar=${solarElevationDeg.toString()};
function read(k){try{return localStorage.getItem(k)}catch(e){return null}}
if(!new RegExp(${JSON.stringify(FIELD_PATH)}).test(location.pathname))return;
var on=null,o=null;
try{o=JSON.parse(read(${JSON.stringify(THEME_STORAGE_KEY)})||"null")}catch(e){}
if(o&&typeof o==="object"&&(o.theme==="sun"||o.theme==="night")&&typeof o.until==="number"&&o.until>Date.now()){on=o.theme==="sun"}
if(on===null){
if(window.matchMedia&&window.matchMedia("(prefers-contrast: more)").matches){on=true}
else if(read(${JSON.stringify(DEMO_STORAGE_KEY)})!=="live"){on=true}
else{on=solar(${String(UAE_CENTROID.lat)},${String(UAE_CENTROID.lon)},new Date())>0}
}
if(!on)return;
document.documentElement.dataset.theme="sun";
function chrome(){var m=document.querySelector('meta[name="theme-color"]');if(m){m.setAttribute("content",${JSON.stringify(THEME_COLORS.sun)});return true}return false}
if(!chrome()){document.addEventListener("DOMContentLoaded",chrome)}
}catch(e){}})()`;
