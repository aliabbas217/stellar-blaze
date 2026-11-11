import ar from "../../../../messages/ar.json";
import en from "../../../../messages/en.json";
import ur from "../../../../messages/ur.json";
import { notificationClickUrl, notificationContent, notificationTargetUrl } from "@/features/push/notification";
import type { PushPayload } from "@/features/push/payload";
import { routing } from "@/i18n/routing";

/*
 * What the service worker shows and where a tap goes. The locale is the one the app last rendered (review focus 2:
 * an Urdu worker must land on /ur/..., not /en/...), the text comes from the bundled strings, and the vibration is
 * the only thing that tells a gloved worker how serious the level is before they look.
 */

const base: PushPayload = {
  v: 1,
  audience: "site",
  target_id: "site-demo-mussafah",
  level: "red",
  template_id: "level-change",
  valid_from: "2026-11-11T09:00:00Z",
};

describe("notificationTargetUrl", () => {
  it("starts with the locale's worker route", () => {
    expect(notificationTargetUrl("ur", base).startsWith("/ur/worker")).toBe(true);
  });

  it.each(routing.locales)("is /%s/worker?from=push&level=<level>", (locale) => {
    expect(notificationTargetUrl(locale, { ...base, level: "orange" })).toBe(`/${locale}/worker?from=push&level=orange`);
  });

  it("falls back to the default locale for a locale it does not know", () => {
    expect(notificationTargetUrl("xx", base)).toBe("/en/worker?from=push&level=red");
  });
});

describe("notificationContent", () => {
  it("tags a site alert by audience and target, and vibrates five times for red in Arabic", () => {
    const content = notificationContent("ar", base);
    expect(content.vibrate).toHaveLength(5);
    expect(content.tag).toBe("site:site-demo-mussafah");
  });

  it("tags a crew alert by its crew", () => {
    expect(notificationContent("en", { ...base, audience: "crew", target_id: "crew-a" }).tag).toBe("crew:crew-a");
  });

  it.each([
    ["green", []],
    ["amber", [200]],
    ["orange", [200, 100, 200]],
    ["red", [400, 100, 400, 100, 400]],
  ] as const)("vibrates %s as %j", (level, pattern) => {
    expect(notificationContent("en", { ...base, level }).vibrate).toEqual(pattern);
  });

  it("builds the English site title from the push messages, and the generic body", () => {
    const content = notificationContent("en", { ...base, level: "amber" });
    expect(content.title).toBe(en.push.title.site.replace("{level}", en.push.level.amber));
    expect(content.body).toBe(en.push.body);
  });

  it("builds the crew title from its own message", () => {
    const content = notificationContent("en", { ...base, audience: "crew", target_id: "crew-a", level: "green" });
    expect(content.title).toBe(en.push.title.crew.replace("{level}", en.push.level.green));
  });

  it("reads Arabic and Urdu from their own strings, not English", () => {
    expect(notificationContent("ar", base).title).toBe(ar.push.title.site.replace("{level}", ar.push.level.red));
    expect(notificationContent("ur", base).title).toBe(ur.push.title.site.replace("{level}", ur.push.level.red));
    expect(notificationContent("ar", base).title).not.toBe(notificationContent("en", base).title);
  });

  it("states the language of the text, so a screen reader pronounces it", () => {
    expect(notificationContent("ur", base).lang).toBe("ur");
  });

  it("renotifies: a level change at a site replaces the earlier notification (same tag) and must still alert", () => {
    expect(notificationContent("en", base).renotify).toBe(true);
  });

  it("uses English for a locale it has no strings for", () => {
    expect(notificationContent("xx", base)).toEqual(notificationContent("en", base));
  });

  it("never puts payload fields other than the level into the visible text", () => {
    const content = notificationContent("en", { ...base, target_id: "site-secret-id", template_id: "tpl-secret" });
    expect(`${content.title} ${content.body}`).not.toMatch(/secret/);
  });
});

describe("notificationClickUrl", () => {
  it("returns the url the notification was created with", () => {
    expect(notificationClickUrl({ url: "/ur/worker?from=push&level=red" }, "en")).toBe("/ur/worker?from=push&level=red");
  });

  it.each([
    ["no data", undefined],
    ["null", null],
    ["a string", "/ur/worker"],
    ["a url that is not a string", { url: 7 }],
    ["an absolute url to another origin", { url: "https://evil.example/worker" }],
    ["a protocol-relative url", { url: "//evil.example/worker" }],
    ["a javascript: url", { url: "javascript:alert(1)" }],
    ["a backslash path", { url: "/\\evil.example" }],
  ])("falls back to the worker route of the stored locale for %s", (_name, data) => {
    expect(notificationClickUrl(data, "ur")).toBe("/ur/worker");
  });
});
