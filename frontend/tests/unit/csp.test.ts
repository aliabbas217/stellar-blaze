import { readFileSync } from "node:fs";
import path from "node:path";
import { buildContentSecurityPolicy } from "../../csp.ts";

/*
 * The Content-Security-Policy builder (redesign S8). With no landing video the string is exactly the policy tests/e2e/headers.spec.ts pins
 * (that file stays unchanged); with a video it adds `frame-src` for youtube-nocookie.com and nothing else.
 */

const root = path.resolve(import.meta.dirname, "../..");
const PINNED =
  "default-src 'self'; img-src 'self' data:; font-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'";
const ID = "jNQXAC9IVRw";

describe("buildContentSecurityPolicy", () => {
  it("with no video it is exactly the pinned policy, and that is the string the header spec pins", () => {
    expect(buildContentSecurityPolicy({ development: false, youtubeId: null })).toBe(PINNED);
    expect(readFileSync(path.join(root, "tests/e2e/headers.spec.ts"), "utf8")).toContain(`"${PINNED}"`);
    expect(PINNED).not.toMatch(/frame-src|youtube/);
  });

  it("with a valid id it adds `frame-src https://www.youtube-nocookie.com` and changes nothing else", () => {
    const withVideo = buildContentSecurityPolicy({ development: false, youtubeId: ID });
    expect(withVideo).toBe(PINNED.replace("; frame-ancestors", "; frame-src https://www.youtube-nocookie.com; frame-ancestors"));
    expect(withVideo.split("; ").filter((directive) => !PINNED.split("; ").includes(directive))).toEqual(["frame-src https://www.youtube-nocookie.com"]);
    // still no wildcard, no plain youtube.com, and the app is still never framed
    expect(withVideo).not.toMatch(/\*|https:\/\/www\.youtube\.com|frame-ancestors (?!'none')/);
  });

  it.each(["", "short", "has space!!", "jNQXAC9IVRwX", "https://youtu.be/x"])("an invalid id (%j) is no video: the pinned policy", (bad) => {
    expect(buildContentSecurityPolicy({ development: false, youtubeId: bad })).toBe(PINNED);
  });

  it("development adds 'unsafe-eval' to scripts in both states and nothing else", () => {
    const dev = buildContentSecurityPolicy({ development: true, youtubeId: null });
    expect(dev).toBe(PINNED.replace("script-src 'self' 'unsafe-inline'", "script-src 'self' 'unsafe-inline' 'unsafe-eval'"));
    expect(buildContentSecurityPolicy({ development: true, youtubeId: ID })).toContain("frame-src https://www.youtube-nocookie.com");
  });

  it("next.config.ts builds its header with this function from the one config file, not with a string of its own", () => {
    const config = readFileSync(path.join(root, "next.config.ts"), "utf8");
    expect(config).toMatch(/buildContentSecurityPolicy\(\{ development, youtubeId: LANDING_YOUTUBE_ID \}\)/);
    expect(config).toMatch(/from "\.\/src\/features\/judge\/landing\/video-config\.ts"/);
    expect(config).not.toMatch(/"default-src 'self'"/);
  });
});
