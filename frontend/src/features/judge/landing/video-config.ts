import config from "./landing-video.json";

/*
 * The landing's video, one source of truth (redesign S8). `landing-video.json` holds the YouTube id of the 3-minute video, or null while there
 * is none. Two places read it and must agree: the "ways in" section (LandingVideo.tsx) decides between the placeholder panel and the
 * click-to-load player, and next.config.ts adds `frame-src https://www.youtube-nocookie.com` to the Content-Security-Policy ONLY when an
 * id is set (csp.ts), so with no video the policy is exactly the one headers.spec.ts pins. To publish the video, change that one line;
 * to swap YouTube for a file of our own, replace the player and drop the `frame-src` (both are in this folder and csp.ts).
 *
 * This file imports nothing but the JSON, so next.config.ts can load it before any app code exists.
 */

/** A YouTube video id: 11 characters of base64url. Anything else is treated as "no video" (the id ends up in an iframe URL and in a header). */
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

export function parseYoutubeId(value: unknown): string | null {
  return typeof value === "string" && YOUTUBE_ID.test(value) ? value : null;
}

/** The validated id from the config file, or null. */
export const LANDING_YOUTUBE_ID: string | null = parseYoutubeId((config as { youtubeId?: unknown }).youtubeId);

/** The privacy-enhanced embed. `autoplay=1` is safe here only because the iframe is created by a press of the Play button, never on load. */
export function youtubeEmbedSrc(id: string): string {
  return `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&cc_load_policy=1`;
}

/** The one origin the page may frame. */
export const YOUTUBE_FRAME_ORIGIN = "https://www.youtube-nocookie.com";
