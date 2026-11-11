# Web Push contract (proposal)

- **Status:** Proposal from the F1 frontend foundation (Task 5), 2026-11-11. B3 Task 0 owns the real contract from 14 Nov.
- **Evidence:** ADR 0004 (tiered alert delivery), ADR 0002 (`NotificationChannel` messages), ADR 0009 and 0010 (versions), `frontend/openapi/stellar-blaze.mock.openapi.json`, RFC 8030 sections 5.2, 5.3 and 7.3, the `web-push` README (`web-push-libs/web-push`).
- **Governed by:** ADR 0004. Tier A is a non-personal level for a site or a crew. Personal risk is computed on the phone and is never sent to the server, in either direction.

This file covers three things: how the browser registers a push subscription with the API, what the API sends, and how it sends it.

## 1. Subscriptions

Both calls go through the web app's same-origin proxy (`/api/v1/*`), like every other API call. Every non-2xx answer is `application/problem+json` with `{type, title, status, detail?, instance?, request_id}`.

### `POST /api/v1/push/subscriptions`

The body is the browser's `PushSubscription.toJSON()` plus the scope the worker chose:

```json
{
  "subscription": {
    "endpoint": "https://push.example/send/abc123",
    "expirationTime": null,
    "keys": { "p256dh": "<base64url>", "auth": "<base64url>" }
  },
  "site_id": "site-demo-mussafah",
  "crew_id": null
}
```

| Field | Rule |
|---|---|
| `subscription.endpoint`, `subscription.keys.p256dh`, `subscription.keys.auth` | Exactly what the browser produced. The API needs them to encrypt and address a message and for nothing else. |
| `subscription.expirationTime` | Epoch milliseconds or `null`. |
| `site_id` | A site id from `GET /api/v1/sites`. Required. |
| `crew_id` | A crew id of that site from `GET /api/v1/sites/{site_id}/crews`, or `null` for site alerts only. |

The response is `201 {"id": "<subscription id>"}`. The client keeps the id so it can delete the subscription later. Unknown `site_id` or `crew_id` is `404`; a body that is not exactly this shape (an extra member included) is `422`.

**The body has no other member, by design.** It carries no worker identifier, no name, no device or account id, no profile, and no personal level. `site_id` and the optional `crew_id` are the whole scope. The OpenAPI schema `PushSubscriptionCreate` sets `additionalProperties: false`, and the mock server rejects extra members with `422`, so a client that starts sending more fails its tests.

### `DELETE /api/v1/push/subscriptions/{subscription_id}`

`204` with no body. It is idempotent: deleting a subscription that is already gone is also `204`. The worker can revoke at any time from the Alerts screen, and the client calls this when it does.

## 2. The push payload

The API sends exactly these six keys, as JSON, and nothing else (ADR 0002: the type forbids extra fields; ADR 0004: "level code and site/crew id only").

```json
{
  "v": 1,
  "audience": "site",
  "target_id": "site-demo-mussafah",
  "level": "amber",
  "template_id": "level-change",
  "valid_from": "2026-11-11T09:00:00Z"
}
```

| Key | Type | Meaning |
|---|---|---|
| `v` | `1` | Payload version. A service worker that does not know the version shows nothing. |
| `audience` | `"site"` or `"crew"` | Whether the message is for everyone at a site or for one crew. |
| `target_id` | string | The site id when `audience` is `"site"`, the crew id when it is `"crew"`. |
| `level` | `"green"`, `"amber"`, `"orange"` or `"red"` | The site or crew level. Not a personal level. |
| `template_id` | string | A message template id owned by the backend ruleset (`backend/rulesets/*.toml`, ADR 0009). The frontend only holds the words for it. The `"level-change"` in the example is made up. |
| `valid_from` | ISO 8601 date-time | When the level applies from. |

The payload carries **no text**. The service worker renders the localized message and the audio from strings bundled with the app, keyed by `level` and `template_id`. This is why the same push works in all six locales.

A `"site"` push goes to every subscription with that `site_id`. A `"crew"` push goes to the subscriptions with that `crew_id`. A subscription with `crew_id: null` never receives a crew push.

**Closed app.** A push wakes the service worker, and the notification shows the site or crew level only. The worker's personal level is computed on the phone when the app is opened or a notification is tapped, from the cached forecast and the profile held on the device (ADR 0004 Tier B). Nothing about it travels back.

## 3. How the API sends it

| Item | Value | Why |
|---|---|---|
| `Urgency` header | `high` | RFC 8030 section 5.3 lists `very-low`, `low`, `normal` and `high`; its example for `high` is a "time-sensitive alert". ADR 0004 requires it. |
| `TTL` header | `3600` seconds | RFC 8030 section 5.2: how long the push service keeps the message for a phone that is not reachable. The value is chosen so that an alert is dropped rather than delivered an hour late. With `0` a message to an unreachable phone is never delivered. |
| VAPID subject (`sub`) | a `mailto:` URI with a real, monitored address | See below. |
| Body | the six-key JSON of section 2, encrypted as Web Push requires | |

The `web-push` npm library names these options `urgency: "high"` and `TTL: 3600` (the Task 7 spike sender uses them). B3 sends from FastAPI through `WebPushChannel` (pywebpush 2.5.0, ADR 0004); map the same values to that library's parameters and check the names against its documentation, because this file was not checked against pywebpush.

### The VAPID subject

The `sub` claim is the contact for the sender. The `web-push` README accepts "either an `https:` or `mailto:` URI", warns against a local placeholder such as `mailto:user@localhost`, and says that "Apple Push may reject localhost-based subjects with `403 BadJwtToken`" and that Safari's endpoint rejects a request whose subject is an `https://localhost` URI. So: use a `mailto:` URI with a real address, in every environment. The subject is backend configuration; the frontend only ever sees the VAPID public key (`VAPID_PUBLIC_KEY`, read at request time, never `NEXT_PUBLIC_*`).

## 4. What must never be in a subscription or a push

**No worker identifier, no free text, no personal level.** This holds in every direction and every environment.

- No worker, member, employee, device or account id, name, phone number or email in a subscription, a payload or a log line tied to one.
- No free text in a payload. A template id and a level are the only things that select a message.
- No personal risk level, workload class, clothing option, heat-work start date or any other profile value. The profile lives on the device.

Guards: the type of a `NotificationChannel` message forbids extra fields (ADR 0002); `frontend/tests/unit/api/contract-governance.test.ts` fails if any schema in the OpenAPI document gains a property or parameter named like a worker, member, employee, heart or symptom reading; and the mock server answers `422` to an unexpected member.

## 5. Open points for B3

These are not decided here.

- **Duplicate registrations.** A browser that re-subscribes may POST the same `endpoint` again. Propose to treat `endpoint` as the natural key and return the existing id, but this file does not specify it.
- **Gone subscriptions.** RFC 8030 section 7.3 says a push service answers `404` for an expired subscription. B3 should delete a subscription when the push service says it is gone; whether `410` is treated the same was not verified here.
- **`template_id` values.** The set of ids, and which of them the service worker must have strings for, is defined by the ruleset. The frontend ships placeholders marked draft until the reviewed wording exists.

## To B3

This file and `frontend/openapi/stellar-blaze.mock.openapi.json` are a **proposal**, written so the frontend could be built and tested before the backend contract existed. They are yours to adopt or replace in B3 Task 0: if you replace them, keep the governance rules of section 4 (the frontend test above checks them against whatever OpenAPI document `api:gen` reads), keep the six-key payload unless ADR 0004 is amended, and regenerate `frontend/src/api/schema.d.ts` with `pnpm api:gen`. The frontend then deletes the mock spec once your spec covers every path in it.
