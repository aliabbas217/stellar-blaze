import ar from "../../../../messages/ar.json";
import en from "../../../../messages/en.json";
import ur from "../../../../messages/ur.json";
import {
  fallbackNotificationContent,
  fallbackTargetUrl,
  fillLevel,
  notificationClickUrl,
  notificationContent,
  notificationTargetUrl,
} from "@/features/push/notification";
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

  it.each(routing.locales)("test_notification_target_url_carries_alert_identity: /%s/worker/alert?audience=&target=&level=&valid_from=", (locale) => {
    expect(notificationTargetUrl(locale, { ...base, level: "orange" })).toBe(
      `/${locale}/worker/alert?audience=site&target=site-demo-mussafah&level=orange&valid_from=2026-11-11T09%3A00%3A00Z`,
    );
  });

  it("names the crew for a crew alert, and encodes the time so '+' and ':' survive a query string", () => {
    expect(notificationTargetUrl("en", { ...base, audience: "crew", target_id: "crew-b", valid_from: "2026-11-11T13:00:00+04:00" })).toBe(
      "/en/worker/alert?audience=crew&target=crew-b&level=red&valid_from=2026-11-11T13%3A00%3A00%2B04%3A00",
    );
  });

  it("falls back to the default locale for a locale it does not know", () => {
    expect(notificationTargetUrl("xx", base)).toBe(
      "/en/worker/alert?audience=site&target=site-demo-mussafah&level=red&valid_from=2026-11-11T09%3A00%3A00Z",
    );
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

describe("fillLevel", () => {
  it("fills the {level} slot", () => {
    expect(fillLevel("Site heat alert: {level}", "Amber")).toBe("Site heat alert: Amber");
  });

  // String.prototype.replace reads these in a replacement string: the matched text, the text after it, a capture group.
  it.each(["$&", "$'", "$`", "$1x", "$$"])("inserts the level name %s as written, not as a replacement pattern", (levelName) => {
    expect(fillLevel("Alert: {level} !", levelName)).toBe(`Alert: ${levelName} !`);
  });
});

describe("the neutral notification (a push the worker cannot read)", () => {
  it.each([
    ["en", en],
    ["ar", ar],
    ["ur", ur],
  ] as const)("is the app name and the generic line from the %s messages", (locale, messages) => {
    const neutral = fallbackNotificationContent(locale);
    expect(neutral.lang).toBe(locale);
    expect(neutral.title).toBe(messages.common.appName);
    expect(neutral.body).toBe(messages.push.body);
  });

  it.each(routing.locales)("has a title and a body in %s", (locale) => {
    const neutral = fallbackNotificationContent(locale);
    expect(neutral.lang).toBe(locale);
    expect(neutral.title.trim()).not.toBe("");
    expect(neutral.body.trim()).not.toBe("");
  });

  it("has a fixed tag with no colon, so it never equals a level notification's audience:target tag", () => {
    expect(fallbackNotificationContent("en").tag).toBe("fallback");
    expect(notificationContent("en", base).tag).not.toBe(fallbackNotificationContent("en").tag);
  });

  it("vibrates once and shorter than every level's pattern, so it claims no level", () => {
    const neutral = fallbackNotificationContent("en").vibrate;
    expect(neutral).toEqual([100]);
    for (const level of ["amber", "orange", "red"] as const) {
      expect(notificationContent("en", { ...base, level }).vibrate[0]).toBeGreaterThan(100);
    }
  });

  it("uses English for a locale it has no strings for", () => {
    expect(fallbackNotificationContent("xx")).toEqual(fallbackNotificationContent("en"));
    expect(fallbackNotificationContent("constructor")).toEqual(fallbackNotificationContent("en"));
  });

  it("opens the worker route in the worker's language, without a level", () => {
    expect(fallbackTargetUrl("ur")).toBe("/ur/worker?from=push");
    expect(fallbackTargetUrl("xx")).toBe("/en/worker?from=push");
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
