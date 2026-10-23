# Xero integration review

## Assumptions and sources

Checked against the official documentation on **23 October 2026**. This is a design review, not a claim of a live Xero integration test. Assume a server-side OAuth 2.0 authorization-code application, Xero organisation tenants, and the Accounting API at `https://api.xero.com/api.xro/2.0`. No particular SDK is assumed: examples describe HTTP contracts. Store an internal organisation-to-Xero-tenant binding; never infer tenancy from a request body supplied by an end user.

Use current granular scopes: `accounting.invoices.read` for ingestion, or `accounting.invoices` when creating invoices; `accounting.settings.read` for the organisation verification below; `offline_access` for background refresh. Request other scopes only for actual operations (for example, creating contacts). The official scopes page says Web/PKCE apps received granular scopes from March 2026 and legacy broad `accounting.transactions[.read]` scopes remain available until September 2027. Some SDK/OpenAPI examples still show broad scopes: inspect the **granted** scopes and the application's migration state rather than copying an old example.

Official references used:

- [Authorization code flow and connections](https://developer.xero.com/documentation/guides/oauth2/auth-flow/)
- [Scopes and granular-scope migration](https://developer.xero.com/documentation/guides/oauth2/scopes/)
- [Token types, refresh rotation and grace period](https://developer.xero.com/documentation/guides/oauth2/token-types/)
- [Invoices: pagination, filters, ordering and validation](https://developer.xero.com/documentation/api/accounting/invoices)
- [If-Modified-Since](https://developer.xero.com/documentation/best-practices/api-call-efficiencies/if-modified-since/)
- [Rate limits and response headers](https://developer.xero.com/documentation/best-practices/api-call-efficiencies/rate-limits/)
- [Idempotent requests](https://developer.xero.com/documentation/guides/idempotent-requests/idempotency/)
- [Accounting response codes](https://developer.xero.com/documentation/api/accounting/responsecodes/)
- [Official Accounting OpenAPI definition](https://github.com/XeroAPI/Xero-OpenAPI/blob/master/xero_accounting.yaml)

## C1 — Connection verification

Starting with stored credentials, the smallest useful sequence is:

1. Check token expiry against UTC with a short safety margin. If needed, refresh via `POST https://identity.xero.com/connect/token` using the application's client authentication and `grant_type=refresh_token`. Atomically save the new access token, refresh token, expiry and credential version. This proves a usable token can be obtained, not that any particular organisation is accessible. Use the access token, never the OIDC ID token.
2. `GET https://api.xero.com/connections` with `Authorization: Bearer <access_token>`. A 200 proves the token works at this endpoint. Require the **expected** `tenantId` with `tenantType=ORGANISATION` in the returned list. Compare it with the authorised internal binding; do not choose the first connection. `id` is a connection ID, distinct from `tenantId`. An empty list or missing target means stop and reconnect/select the correct organisation. This proves connection membership, not invoice permission.
3. `GET https://api.xero.com/api.xro/2.0/Organisation` with that same bearer token, `xero-tenant-id: <tenantId>`, and `Accept: application/json`. With `accounting.settings.read` granted, require 200 and the expected organisation identity. This proves a tenant-scoped Accounting API call actually reaches the intended organisation before invoices are read.

If an existing minimal-scope integration lacks settings access, connections membership can verify the selection locally, but cannot prove a tenant-scoped request succeeds; explicitly report that narrower assurance. Do not silently add permission merely to run a health check. Invoice access is ultimately proven by the first permitted invoice request.

## C2 — Failure diagnosis

Record status, a sanitised error classification, endpoint template, internal tenant binding, credential version, granted scope names, environment and Xero correlation ID. Do not record bearer tokens or raw invoice bodies. Compare a failing worker's configuration with a known-good deployment using names/versions, not secret values.

1. **Validate common request construction first.** Confirm the Accounting base URL, `/Invoices` path, supported method, JSON accept header, current bearer access token and `xero-tenant-id`. Re-run connections with the **same credential version** as the failing request. Ensure it contains the intended organisation's `tenantId`; reject mismatched internal/Xero bindings. Verify that staging jobs did not load production credentials, a different OAuth app, a stale secret version or another tenant's stored token. Xero demo companies use the same API base URL; do not invent a separate sandbox hostname.
2. **401:** Check `expires_in`/expiry, clock skew, revoked/disconnected authorisation, malformed bearer headers, use of an ID token, and wrong client/credential selection. Serialize refresh for the underlying OAuth grant, re-read the latest credential version after acquiring the lock, refresh once if required, atomically rotate both tokens, then retry a safe read once. Multiple organisation bindings can share one grant: a lock only on the organisation is insufficient. If refresh returns `invalid_grant` or the tenant is no longer connected, mark the connection as requiring reauthorisation and stop retrying. A prior successful connections call can have raced expiry or used a different token.
3. **403:** Inspect the granted scopes (not only requested scopes), including granular versus legacy scope migration. Verify the connected user's role/permissions for invoices and that the target organisation supports the intended operation. Re-consent when a necessary scope is missing; ask an authorised administrator to correct role access when applicable. Token refresh cannot add scopes or fix a forbidden operation. Do not loop retries.
4. **404:** Verify the exact route, API version, resource ID and tenant context. A valid invoice ID from tenant A does not identify an invoice in tenant B. Distinguish collection-route failures from `/Invoices/{id}` failures; inspect proxy/rewrite configuration and request IDs. For a collection, no matching invoices should be an empty successful result, not an invented “not found” explanation. A successful tenant-scoped organisation request narrows the problem to the invoice route/resource/permissions. Avoid using 404 alone as proof of deletion or automatically creating a replacement invoice.

The HTTP status is a starting hypothesis. Use the sanitised response and reproducible request checks to identify the cause, with bounded retries only after a concrete corrective action.

## C3 — Resumable incremental synchronisation

Maintain per-tenant `committed_watermark`, active run ID, run start time, fixed lower bound, query/version, page checkpoint and status. Keep invoice data keyed by `(tenant_id, InvoiceID)`, with `UpdatedDateUTC` and a payload digest. Use a lease with fencing/version checks so an expired worker cannot advance another worker's cursor.

For a run, let `T` be its UTC start and `L = committed_watermark - overlap` (for example, five minutes, explicitly an operational choice). For the initial backfill, use an agreed earliest modified timestamp and document the historical coverage. Request:

```http
GET /api.xro/2.0/Invoices?page=1&pageSize=100
Authorization: Bearer <access_token>
xero-tenant-id: <tenantId>
If-Modified-Since: <L formatted in UTC as yyyy-mm-ddThh:mm:ss>
Accept: application/json
```

Keep `L` and all query parameters fixed through the run. Use paged detailed responses when line items are needed. The current invoice documentation specifies default ordering `UpdatedDateUTC ASC, InvoiceId ASC`; retain it. Do not substitute invoice issue `Date` for modification time. Do not assume a custom filter on `UpdatedDateUTC` is an optimised large-volume filter: it is not listed among the documented optimised `where` fields.

For each page, validate records, then in one **local** database transaction upsert records and persist the page checkpoint under the lease fence. Never replace newer local data with an older replay. Equal timestamps with changed payloads require reconciliation rather than silent timestamp-only dismissal. Follow pagination metadata when present; otherwise continue until an empty page (safe even when the preceding page was full). Handle deleted/voided statuses explicitly; absence from a changed-since result is not a deletion signal. Only after the complete run has been durably applied may `committed_watermark` advance to `T`, not the maximum timestamp observed. Records modified after `T` may already have been read; replaying them is safe.

On a crash or partial page failure, keep the committed watermark unchanged. For safe restart, replay from **page 1 with the same lower bound**, using upserts; the page checkpoint gives observability but is not a snapshot cursor. Persist malformed records in a quarantine queue and block watermark advancement until they are resolved or an explicit repair policy is recorded. Avoid silently skipping failed records.

**Consistency limit:** paged Xero results are not a documented immutable snapshot. Concurrent edits can reorder records and shift page boundaries. An overlap reduces boundary/timestamp risk but does not prove that no old record was skipped under arbitrary concurrent changes. Run periodic broader/full reconciliation and use verified webhooks as an additional change signal, not a replacement for reconciliation. Alert on reconciliation discrepancies and lag. If the run exceeds its time/call budget, reschedule with the same lower bound; do not advance the committed watermark just to make progress look healthy. For very large organisations, use documented optimised filters/partitions after testing coverage and measure throughput against tenant quotas.

## C4 — Rate limits and retry discipline

On 429, capture `Retry-After` (Xero documents seconds), `X-Rate-Limit-Problem`, `X-MinLimit-Remaining`, `X-DayLimit-Remaining`, `X-AppMinLimit-Remaining` and `Xero-Correlation-Id`. Treat the retry time as a **minimum**: schedule no earlier than `now + Retry-After`, adding a small jitter. If absent/invalid, use capped exponential backoff with full jitter, e.g. `uniform(0, min(60s, 2^attempt seconds))`. A valid longer Retry-After must not be capped to 60 seconds.

Use shared per-tenant cooldowns and concurrency/rate budgets across all workers, plus an app-wide minute budget. Current published limits are 5 concurrent calls and 60 calls/minute per tenant, with daily allowances of 1,000 for Starter and 5,000 for higher tiers; the app-wide minute limit is 10,000. Configure limits by tier and use live response headers as operational guidance. Some examples on the same documentation page still state 5,000 universally; do not apply that to Starter.

Start conservatively (e.g. two in-flight calls per tenant), preserve fairness between tenants, and schedule a delayed job instead of sleeping a worker for a long daily cooldown. Persist `not_before`, attempt count and elapsed retry budget. One policy is at most five transient attempts within a short execution window; defer quota cooldowns and checkpointed work as scheduled continuation, with an overall job age limit/alert. Avoid immediate re-enqueue loops or permanently starving a large tenant.

Retry transport errors and transient 5xx only when the operation is safe; mutation retries require C5. A 401 permits one coordinated refresh attempt; repeated 401 or `invalid_grant` requires intervention. Do not blindly retry 400/422 validation failures, 403 permission failures, confirmed wrong-route/resource 404s, 501 unsupported operations or idempotency-payload conflicts. Investigate 412/header/TLS configuration. Check per-element validation errors even on a 200 batch response (`summarizeErrors=false`). Xero documents organisation-offline 503 as potentially lasting minutes: schedule a longer delay rather than a tight loop.

## C5 — Duplicate prevention and ambiguous outcomes

Persist an outbound operation **before** sending: `(tenant_id, internal_order_id, operation_version)` unique, payload hash, method/URL, provider idempotency key, first-attempt time, state, and eventually `InvoiceID`. Commit the business intent and outbox entry together; a worker claims it with a lease. Different payloads/edits are separate explicitly versioned operations. A local unique constraint prevents two workers from independently deciding to create for the same order.

For a new invoice, send the stable `Idempotency-Key` accepted by the current Accounting API, using a globally unique value within the provider's 128-character limit (for example, four concatenated UUID hex values). Persist the exact request representation. Immediate retry uses the same key, URL, method and body. Xero's documented response cache lasts **six minutes from the first call**, including some failed outcomes; replay attempts still consume quota. A different request with the same key returns 400. Do not assume 24-hour retention or that retrying a cached 500 will execute the request again.

After a timeout, mark the operation `unknown`, not `failed`. Within a conservative margin of the six-minute window, a same-key replay may recover the original outcome. If that window has elapsed, or repeated cached errors leave the result ambiguous, **do not blindly resend**, even with the old key: Xero will treat an expired key as new.

Reconcile with GET before another create. Where the business allows it, use a deterministic, integration-owned sales `InvoiceNumber` and store a recognisable order reference. Retrieve by exact invoice number (or known `InvoiceID`) in the correct tenant, and verify type, contact, currency, amounts and the internal operation mapping. `Reference`/search hits alone are not uniqueness guarantees; bill-number semantics must be treated separately from sales invoices. If the matching invoice exists, persist its ID and mark success. If a mismatch or multiple candidates exist, quarantine for investigation. If absence cannot be established confidently, keep the operation unknown and escalate rather than risk a duplicate. Only after a controlled reconciliation establishes non-creation should a newly keyed attempt be authorised by the workflow, under the same local uniqueness/lease guard.

Handle batch creates per invoice: an HTTP 200 is not proof every element succeeded. The practical guarantee is durable local deduplication plus bounded provider replay and reconciliation, not a claim of a distributed exactly-once transaction.

## C6 — Observability and security

**Structured logs:** operation name, internal tenant surrogate, job/run ID, request ID, trace ID, outbox operation ID, attempt, safe endpoint template, status/error class, duration, page number, record count, watermark before/after, credential version and `Xero-Correlation-Id`. Use a hash of idempotency keys if correlation is needed. Avoid arbitrary provider error bodies; allowlist sanitised categories.

**Metrics:** calls/latency/error rates by endpoint and status, quota remaining, 429 frequency, queue age, last successful sync, watermark lag, records applied/deduplicated/quarantined, refresh failures, retry counts, unknown outbound operations and reconciliation mismatches. Put high-cardinality identifiers in logs/traces rather than unbounded metric labels.

**Alerts:** persistent lag or queue growth, repeated authentication failures, tenant binding mismatches, unexpected forbidden/not-found spikes, repeated rate-limit exhaustion, unknown creates exceeding the replay window, expired leases and reconciliation discrepancies. Include a runbook and safe correlation IDs, never tokens or invoice contents.

**Secrets:** TLS in transit, KMS/secret-manager encryption at rest, least-privilege worker access, tenant-scoped database queries and audit trails for credential reads/changes. Keep access/refresh tokens, client secrets and signing material out of source control and the frontend. Never log Authorization/Cookie headers, auth codes, complete JWTs, refresh tokens, client secrets, invoice line descriptions, customer addresses, bank details or raw payloads. Redact exception telemetry and protect backups too.

Refresh rotation must use one lock/CAS version per **OAuth grant**, which may serve several organisations. Atomically replace both tokens, avoid stale workers overwriting new credentials, and honour the documented 30-minute old-refresh-token grace only for recovery. Access tokens last up to 30 minutes and refresh tokens up to 60 days; use returned expiry values. Rotate client secrets via a controlled secret-manager rollout, verify the replacement before retiring the old version where supported, and provide a reconnect/revocation procedure for compromise or user disconnection.
