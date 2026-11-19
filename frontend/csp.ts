import { parseYoutubeId, YOUTUBE_FRAME_ORIGIN } from "./src/features/judge/landing/video-config.ts";

/*
 * The Content-Security-Policy of every response, as a function so that a unit test can assert both states (tests/unit/csp.test.ts) and
 * next.config.ts stays a list of settings. tests/e2e/headers.spec.ts pins the exact string for a build with no landing video.
 * The directives are explained in next.config.ts.
 *
 * `frame-src` is added ONLY when the landing has a video (src/features/judge/landing/landing-video.json holds a valid id): the policy
 * would otherwise grant a third party a door that nothing opens. With no id the string is exactly the one before the video existed.
 */
export function buildContentSecurityPolicy({ development, youtubeId }: { readonly development: boolean; readonly youtubeId: string | null }): string {
  return [
    "default-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `script-src 'self' 'unsafe-inline'${development ? " 'unsafe-eval'" : ""}`,
    "connect-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    ...(parseYoutubeId(youtubeId) === null ? [] : [`frame-src ${YOUTUBE_FRAME_ORIGIN}`]),
    "frame-ancestors 'none'",
  ].join("; ");
}
