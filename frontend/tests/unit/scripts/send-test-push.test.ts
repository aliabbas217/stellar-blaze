import { buildPayload, parseSendArgs, readSubscription, UsageError, USAGE } from "../../../scripts/send-test-push.ts";
import { parsePushPayload } from "@/features/push/payload";
import { crews, SITE_DEMO } from "@/mocks/fixtures";

/*
 * The spike's sender builds the payload the service worker will parse. The strongest check is the cross-check: whatever
 * the sender builds, the worker's own guard must accept, and nothing outside the contract's six keys may be in it.
 */

const NOW = new Date("2026-11-12T10:30:15.123Z");

describe("buildPayload", () => {
  it.each(["green", "amber", "orange", "red"] as const)("builds a payload the worker accepts for %s", (level) => {
    const payload = buildPayload({ subFile: "x.json", level, audience: "site", target: SITE_DEMO }, NOW);
    expect(parsePushPayload(payload)).toEqual(payload);
  });

  it("builds a crew payload the worker accepts", () => {
    const payload = buildPayload({ subFile: "x.json", level: "red", audience: "crew", target: "crew-a" }, NOW);
    expect(parsePushPayload(payload)).toMatchObject({ audience: "crew", target_id: "crew-a" });
  });

  it("has exactly the six keys of the contract and an ISO time without milliseconds", () => {
    const payload = buildPayload({ subFile: "x.json", level: "amber", audience: "site", target: SITE_DEMO }, NOW);
    expect(Object.keys(payload).sort()).toEqual(["audience", "level", "target_id", "template_id", "v", "valid_from"]);
    expect(payload.valid_from).toBe("2026-11-12T10:30:15Z");
  });
});

describe("parseSendArgs", () => {
  it("defaults to a site alert for the first fixture site", () => {
    expect(parseSendArgs(["--sub", "s.json", "--level", "amber"])).toEqual({
      subFile: "s.json",
      level: "amber",
      audience: "site",
      target: SITE_DEMO,
    });
  });

  it("defaults a crew alert to the first fixture crew", () => {
    expect(parseSendArgs(["--sub", "s.json", "--level", "red", "--audience", "crew"])).toMatchObject({
      audience: "crew",
      target: crews[0]?.id,
    });
  });

  it("takes an explicit target", () => {
    expect(parseSendArgs(["--sub", "s.json", "--level", "red", "--audience", "crew", "--target", "crew-b"])).toMatchObject({
      target: "crew-b",
    });
  });

  it("returns help for --help and for -h, without needing the other flags", () => {
    expect(parseSendArgs(["--help"])).toBe("help");
    expect(parseSendArgs(["-h"])).toBe("help");
  });

  it.each([
    ["no --sub", ["--level", "amber"], /--sub/],
    ["no --level", ["--sub", "s.json"], /--level/],
    ["an unknown level", ["--sub", "s.json", "--level", "purple"], /--level must be one of/],
    ["an unknown audience", ["--sub", "s.json", "--level", "red", "--audience", "worker"], /--audience must be one of/],
    ["an unknown flag", ["--sub", "s.json", "--level", "red", "--worker", "w-1"], /worker/],
  ])("throws a UsageError for %s", (_name, argv, message) => {
    expect(() => parseSendArgs(argv)).toThrow(UsageError);
    expect(() => parseSendArgs(argv)).toThrow(message);
  });
});

describe("readSubscription", () => {
  const good = { endpoint: "https://push.example/send/abc", expirationTime: null, keys: { p256dh: "p", auth: "a" } };

  it("returns what the push library needs", () => {
    expect(readSubscription(JSON.stringify(good))).toEqual({ endpoint: good.endpoint, keys: good.keys });
  });

  it.each([
    ["not JSON", "{nope"],
    ["no endpoint", JSON.stringify({ keys: good.keys })],
    ["an endpoint that is not https", JSON.stringify({ ...good, endpoint: "http://push.example/x" })],
    ["no keys", JSON.stringify({ endpoint: good.endpoint })],
    ["null", "null"],
  ])("throws a UsageError for %s", (_name, raw) => {
    expect(() => readSubscription(raw)).toThrow(UsageError);
  });
});

describe("usage text", () => {
  it("names every flag, the fixed headers and the environment", () => {
    for (const word of ["--sub", "--level", "--audience", "--target", "Urgency: high", "TTL 3600", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"]) {
      expect(USAGE).toContain(word);
    }
  });
});
