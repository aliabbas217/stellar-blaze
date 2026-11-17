# ADR 0067: Web Push subscription endpoints must be on an allow-list of push-service hosts (default on, overridable)

- **Status:** Accepted by the architect (Ali informed 2026-11-15; he can overrule)
- **Date:** 2026-11-15
- **Deciders:** the architect (Claude); recommendation of the B3 controller after its final whole-branch review
- **Supersedes / superseded by:** un-parks the host allow-list parked in the B3 ledger; amends [ADR 0058](0058-alert-events-push-contract-and-stale-forecast-fallback.md) decision 3 (subscriptions)
- **Evidence:** the B3 final whole-branch review (probes on the repo harness, 2026-11-15); B3 commits `68944c2` (response cap, send-time endpoint check, serialised subscription caps) and `ed2e085` (IPv6 prefix refusal, stop lane); ADR 0058 decision 3; ADR 0062 (public demo access).

## Context
`POST` subscription routes are reachable by any holder of the public demo token, and the dispatcher then POSTs to the endpoint URL the client supplied. Validation today is syntactic (https only, no credentials, port 443, a DNS name rather than an IP literal, a TLD of letters, no internal suffix), with a send-time resolver that refuses non-global addresses and a redirect refusal. The review showed three consequences of letting arbitrary hosts in:
1. **Flood, permanent loss (I1).** 450 hanging public site subscriptions (distinct `?n=` query variants count as distinct endpoints) made the site amber event store `delivered=0, failed=451`: throughput is 16 sends per 12 s, so about 386 sends fit in the run budget and the rest fail with `deadline`. The event row is stored and deduplicated, so this is permanent loss for every real subscriber, not delay. Per-host fairness does not help against many subdomains of one domain.
2. **Decompression bomb (C1, fixed by 68944c2):** a 1 MB gzip body expanded to about 1 GB inside one send.
3. **SSRF class:** every new address form (IPv4-mapped, NAT64, 6to4, Teredo) needed its own refusal.

## Options
1. **Accept the residual** (parked): zero work, keeps the permanent-loss path open to anyone with the demo token.
2. **Per-host or per-subscription fairness:** does not stop many subdomains.
3. **Allow-list of push-service host suffixes, default on, configurable override (chosen).** Closes the flood, bomb and SSRF classes together at the one place the URL is accepted.
4. **Authenticated subscriptions:** not available; the demo token is public by design (ADR 0062).

## Decision
`create_push_subscription` accepts an endpoint only if its host matches the allow-list; any other host answers 422 `endpoint-host-not-allowed` (additive contract change; description updated). The send path re-checks the host at send time, so a row stored earlier from another host is not reached. The default list covers Google FCM, Mozilla autopush, Apple Web Push and Windows WNS host suffixes; the implementer takes each suffix from the vendor's current documentation and cites the source in code comments (not from memory). The override is a runtime-tunable setting (ADR 0010) so a pilot can add hosts. The existing syntactic checks, the send-time resolver, the redirect refusal and the 16 KiB response cap stay.

## Consequences
- UnifiedPush and other self-hosted push hosts stop working unless the override lists them. For the intended phones (Android Chrome, iOS Safari web push, Edge, Firefox) the default list is enough.
- **Cost of being wrong:** a legitimate push-service host missing from the list gives that subscriber a 422 at subscribe time, which is loud, not silent; the cost of a list that is too wide is the residual described above.
- A vendor can change its hostnames; the real-phone spike (T15) is the check.

## Revisit trigger
A pilot that uses another push service; the real-phone spike shows a host not on the list; a vendor changes hostnames.

## Links
[ADR 0058](0058-alert-events-push-contract-and-stale-forecast-fallback.md) · [0062](0062-public-demo-access-model.md) · [0010](0010-runtime-tunable-configuration.md)
