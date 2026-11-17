// Sends one Web Push message to a real phone's subscription: the real-phone spike's sender. Not part of the app.
//   pnpm push:send --sub subscription.json --level amber
// Node strips the types of this file: no enums, relative imports end in ".ts". VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and
// VAPID_SUBJECT come from the environment; `pnpm push:send` reads .env.spike.local (gitignored) when it exists.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import * as webpush from "web-push";
import { SITE_DEMO, crews } from "../src/mocks/fixtures.ts";

const LEVELS = ["green", "amber", "orange", "red"] as const;
const AUDIENCES = ["site", "crew"] as const;

export type Level = (typeof LEVELS)[number];
export type Audience = (typeof AUDIENCES)[number];

export interface SendOptions {
  subFile: string;
  level: Level;
  audience: Audience;
  target: string;
}

/** The payload of docs/contracts/web-push.md section 2: six keys, no text, nothing about a worker. */
export interface TestPayload {
  v: 1;
  audience: Audience;
  target_id: string;
  level: Level;
  template_id: string;
  valid_from: string;
}

export const USAGE = `Usage: pnpm push:send --sub <file.json> --level <green|amber|orange|red> [--audience site|crew] [--target <id>]

  --sub       JSON file with the phone's subscription (the Alerts page shows it with ?debug=push)
  --level     the level to send
  --audience  site (default) or crew
  --target    the site id (default ${SITE_DEMO}) or, for a crew, its id

Environment (put it in .env.spike.local, which is gitignored): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
(a mailto: address that is really yours: Apple's push service rejects a placeholder such as mailto:user@localhost).
Generate keys once with: pnpm exec web-push generate-vapid-keys
Sends with Urgency: high and TTL 3600 and prints the ISO time of the send and the push service's status code.
`;

/** Thrown for a bad command line: the message says what is wrong, the caller prints it with the usage. */
export class UsageError extends Error {}

function oneOf<T extends string>(name: string, value: string, allowed: readonly T[]): T {
  const match = allowed.find((candidate) => candidate === value);
  if (match === undefined) throw new UsageError(`--${name} must be one of ${allowed.join(", ")} (got ${JSON.stringify(value)})`);
  return match;
}

function parseFlags(argv: readonly string[]) {
  try {
    return parseArgs({
      args: [...argv],
      options: {
        sub: { type: "string" },
        level: { type: "string" },
        audience: { type: "string" },
        target: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
      strict: true,
    }).values;
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
}

/** The options for `argv` (without node and the script), or "help". Throws UsageError. */
export function parseSendArgs(argv: readonly string[]): SendOptions | "help" {
  const values = parseFlags(argv);
  if (values.help === true) return "help";
  if (values.sub === undefined) throw new UsageError("--sub <file.json> is required");
  if (values.level === undefined) throw new UsageError("--level is required");

  const audience = oneOf("audience", values.audience ?? "site", AUDIENCES);
  const defaultTarget = audience === "site" ? SITE_DEMO : crews[0]?.id;
  const target = values.target ?? defaultTarget;
  if (target === undefined || target === "") throw new UsageError("--target is required for a crew");
  return { subFile: values.sub, level: oneOf("level", values.level, LEVELS), audience, target };
}

/** The message to send. `template_id` is a made-up id for the spike: the worker builds its text from the level alone. */
export function buildPayload(options: SendOptions, now: Date): TestPayload {
  return {
    v: 1,
    audience: options.audience,
    target_id: options.target,
    level: options.level,
    template_id: "spike-test",
    valid_from: now.toISOString().replace(/\.\d{3}Z$/, "Z"),
  };
}

/** The subscription JSON a phone produced, checked for what the push service needs. Throws UsageError. */
export function readSubscription(raw: string): webpush.PushSubscription {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new UsageError("the --sub file is not valid JSON");
  }
  const sub = parsed as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null;
  const endpoint = sub?.endpoint;
  const p256dh = sub?.keys?.p256dh;
  const auth = sub?.keys?.auth;
  if (typeof endpoint !== "string" || !endpoint.startsWith("https://") || typeof p256dh !== "string" || typeof auth !== "string") {
    throw new UsageError("the --sub file must hold { endpoint (https), keys: { p256dh, auth } }");
  }
  return { endpoint, keys: { p256dh, auth } };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new UsageError(`${name} is not set (put it in .env.spike.local, see --help)`);
  }
  return value.trim();
}

async function main(argv: readonly string[]): Promise<number> {
  try {
    const options = parseSendArgs(argv);
    if (options === "help") {
      console.log(USAGE);
      return 0;
    }
    const subscription = readSubscription(readFileSync(options.subFile, "utf8"));
    webpush.setVapidDetails(requireEnv("VAPID_SUBJECT"), requireEnv("VAPID_PUBLIC_KEY"), requireEnv("VAPID_PRIVATE_KEY"));

    const sentAt = new Date();
    const payload = buildPayload(options, sentAt);
    // The endpoint is the phone's address: never print it, only which push service it belongs to.
    console.log(`push service ${new URL(subscription.endpoint).origin}`);
    console.log(`payload ${JSON.stringify(payload)}`);
    try {
      const result = await webpush.sendNotification(subscription, JSON.stringify(payload), { urgency: "high", TTL: 3600 });
      console.log(`${sentAt.toISOString()} status ${String(result.statusCode)}`);
      return 0;
    } catch (error) {
      if (!(error instanceof webpush.WebPushError)) throw error;
      console.error(`${sentAt.toISOString()} status ${String(error.statusCode)} ${error.body}`);
      if (error.statusCode === 404 || error.statusCode === 410) {
        console.error("The push service says this subscription is gone: subscribe again on the phone.");
      }
      return 1;
    }
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`${error.message}\n\n${USAGE}`);
      return 2;
    }
    throw error;
  }
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2));
}
