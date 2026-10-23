# Full-stack coding assessment

Four deliverables in one repository: a reservation ledger, a fulfilment optimiser, a Xero integration review, and **Fieldwork**, a working variant product page with a FastAPI backend.

- `A/`: executable Python ledger, example input, tests and complexity explanation.
- `B/`: O(WQ) Python optimiser, example input, tests and proof of tie-breaking.
- `C/answers.md`: six Xero answers with current official references.
- `app/backend/`: FastAPI + transactional SQLite storage and API tests.
- `app/frontend/`: React + TypeScript + Vite, domain logic, API boundary and UI tests.
- `docs/AI_DISCLOSURE.md`: specific disclosure of AI assistance.
- `docs/INTERVIEW_GUIDE.zh-CN.md`: Chinese walkthrough, debugging drills and change exercises.
- `docs/VERIFICATION.md`: executed checks, verification limits and manual review steps.

## Quick start

Requirements: **Python 3.11+**, **Node.js 22 LTS (22.12+) or 24 LTS**, npm, and free local ports 8000/5173. No API keys, cloud services or real customer data are needed. Run commands from this repository's root.

macOS/Linux:

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
npm ci --prefix app/frontend
python scripts/dev.py
```

Windows PowerShell:

```powershell
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
npm ci --prefix app/frontend
.\.venv\Scripts\python.exe scripts/dev.py
```

Open **http://127.0.0.1:5173**. API documentation is at **http://127.0.0.1:8000/docs**. Ctrl+C stops both services. The local launcher has no hot reload; for backend iteration use the separate commands below. Vite provides frontend hot reload.

Or use two terminals with the Python environment activated:

```sh
python -m uvicorn app.backend.main:app --host 127.0.0.1 --port 8000 --reload
```

```sh
npm run dev --prefix app/frontend
```

The frontend uses relative `/api` requests, proxied by Vite to port 8000. This avoids cross-origin configuration and keeps API URLs out of UI components. API responses use `Cache-Control: no-store`. `npm run build --prefix app/frontend` type-checks and builds production assets. `npm run preview --prefix app/frontend` serves that build on port 4173 with the same API proxy; the backend must be running. This is a local review setup, not production hosting.

SQLite is created and seeded at `app/backend/data/store.sqlite3` on first startup. Existing stock/cart/replay records survive restarts. Set `APP_DB_PATH` to a **file** path to isolate a run; `:memory:` is not supported because requests use separate connections. To reset demo data, stop the services, remove the ignored `app/backend/data/` directory, then restart. If a browser has an unresolved add request, clear its `fieldwork.pending-add.v1` session-storage entry when deliberately resetting the demo database.

## Run all checks

```sh
python scripts/check.py
```

Optional real HTTP startup/flow check on macOS/Linux (ports 8000/5173 must be free): `python scripts/smoke.py`. It uses a temporary database and shuts its services down after the check.

Individual checks:

```sh
python -m pytest -q
python -m pytest A -q
python -m pytest B -q
python -m pytest app/backend/tests -q
npm test --prefix app/frontend
npm run build --prefix app/frontend
python A/solution.py < A/example.in
python B/solution.py < B/example.in
```

The `<` examples use a POSIX shell. PowerShell equivalent: `Get-Content A/example.in | python A/solution.py`. CI is configured for Python 3.11 and 3.13 with Node 22; a workflow file is not a claim that a hosted CI run has already occurred.

## Product and behaviour

The fictional product has two dimensions (Ocean/Clay/Forest and S/M/L), eight real SKUs, eight local SVG illustration assets, varying prices and stock, one missing combination (**Clay/L**) and one sold-out SKU (**Clay/M**). **Forest/M has one unit** for the last-item race scenario. Prices are integer AUD cents; all merchandise copy and data are synthetic.

The page starts with incomplete selection. Colour selection keeps or clears size depending on availability; impossible and sold-out size choices are labelled and disabled. Colour remains selectable so users can recover from incompatible sizes. The resolved SKU is derived from product data and selection, not stored as a second independent state. Price/image/stock come from that SKU. A valid number is clamped when stock or SKU changes; temporarily invalid numeric edits disable submission and are normalised on blur. When stock is zero the quantity control is disabled (there is no valid quantity in the interval 1..0).

Add-to-bag uses an immediate ref guard plus a disabled button, then server-side idempotency. A timeout, malformed response or 5xx leaves the outcome uncertain: preserve the key and original payload and offer **Retry previous addition**. Session storage allows recovery after a reload in the same tab. Confirmed 4xx business/validation failures clear that pending action; a corrected/new action gets a new key. A replay's response is historical, so confirmed results are followed by fresh product/cart reads. If those reads fail, confirmed addition remains successful and a separate refresh action is shown. Older overlapping refreshes cannot overwrite a newer add/reconciliation.

## Storage and concurrency decisions

There is one explicitly shared **demo cart**. Authentication, user/cart isolation, checkout, payment and production deployment are out of scope. Add-to-cart immediately reserves units by decrementing available stock; a separate on-hand ledger is unnecessary for this bounded app. There is no expiration/release operation, so restarting does not free stock. Task A is a standalone exercise, not silently reused as the web app's persistence layer.

Each request opens its own SQLite connection. `BEGIN IMMEDIATE` acquires the database write reservation before checking idempotency or reading stock. A conditional `UPDATE ... WHERE available_quantity >= requested_quantity`, cart upsert and idempotency insert occur in that same transaction. `CHECK` constraints defend non-negative stock and positive cart quantities. Any exception rolls back all three. WAL allows readers alongside a writer; a five-second busy timeout bounds contention, with a structured 503 on SQLite operational failure. The correctness boundary is the SQLite file, not an in-process Python lock, so separate app processes sharing that file cannot both reserve the last unit.

SQLite serialises writers, appropriate for a small local app. A production/high-throughput version would use a database such as PostgreSQL with row-level locking/conditional updates, authenticated cart IDs, lifecycle-managed reservations and idempotency retention policy. Do not place SQLite on arbitrary network filesystems or claim this design scales to multi-region writes.

## API contract

All examples assume fresh seed data. Monetary fields are integer cents, quantities are integers, JSON property names use snake_case. Each response includes `X-Request-ID`; error JSON is structured as `{ "error": { "code", "message", "details" } }`.

### GET /api/products/{id}

The only product ID is `everyday-tee`. Returns **200** with product metadata, option definitions and all eight SKU objects. Example excerpt (remaining SKUs omitted only in this documentation):

```json
{
  "id": "everyday-tee",
  "name": "The Everyday Tee",
  "description": "A softer everyday essential. A relaxed silhouette in substantial organic cotton, made for wherever the day takes you.",
  "currency": "AUD",
  "options": [
    {"id": "colour", "name": "Colour", "values": ["Ocean", "Clay", "Forest"]},
    {"id": "size", "name": "Size", "values": ["S", "M", "L"]}
  ],
  "skus": [
    {"id": "ocean-s", "price_cents": 3900, "available_quantity": 8, "image": "/images/ocean-s.svg", "options": {"colour": "Ocean", "size": "S"}}
  ]
}
```

Unknown product: **404**, `PRODUCT_NOT_FOUND`. Images are frontend assets served on the frontend origin.

### POST /api/cart/items

```http
POST /api/cart/items
Content-Type: application/json
Idempotency-Key: review-add-001

{"sku_id":"ocean-s","quantity":2}
```

The key is required, 1–128 characters in `[A-Za-z0-9._:-]`. The JSON object permits only `sku_id` (1–100 lowercase letters/digits/hyphens) and integer `quantity` (1..1,000,000). Strings, booleans, fractions, zero and negative quantities are rejected. Supplied price/stock or any extra fields are rejected rather than trusted. Existing cart units have already been reserved, so current available stock limits each incremental addition.

Success: **201**, `Idempotency-Replayed: false`:

```json
{
  "added": {"sku_id":"ocean-s","quantity":2},
  "remaining_stock":6,
  "cart": {
    "items":[{"sku_id":"ocean-s","quantity":2,"price_cents":3900,"colour":"Ocean","size":"S","image":"/images/ocean-s.svg"}],
    "total_item_count":2,
    "subtotal_cents":7800,
    "currency":"AUD"
  }
}
```

Repeating the same key with the same validated payload returns the original status/body and `Idempotency-Replayed: true`, without another mutation. JSON whitespace/property order does not affect equality. Changing the payload under an existing key returns **409**, `IDEMPOTENCY_CONFLICT`. Keys are scoped to this app's single cart/POST operation, persist in SQLite and do not expire in this demo. Different intentional additions need different keys.

Business error example, **409**:

```json
{"error":{"code":"INSUFFICIENT_STOCK","message":"There is not enough stock for this quantity.","details":{"available_quantity":0}}}
```

Error/status cases:

- **404 `SKU_NOT_FOUND`**: syntactically valid but unknown SKU.
- **409 `INSUFFICIENT_STOCK`**: current availability cannot satisfy this addition.
- **409 `IDEMPOTENCY_CONFLICT`**: key already used for a different payload.
- **422 `VALIDATION_ERROR`**: malformed JSON, missing/invalid key, invalid fields or extra fields. `details.fields` lists safe field paths and validation types; input values are not echoed.
- **500 `INTERNAL_ERROR`**: unexpected failure; no internal exception detail is returned.
- **503 `DATABASE_BUSY`**, `Retry-After: 1`: storage temporarily unavailable; retry with the same key.

Definite 404/insufficient-stock responses are cached under the key, even if stock later changes. Validation errors and rolled-back 5xx are not cached. This explicit policy differs from Xero's own short-lived error cache described in Task C. A replay does not bypass current schema validation: malformed input is rejected before route execution.

### GET /api/cart

Returns **200** with the `cart` object shown above. A fresh cart is:

```json
{"items":[],"total_item_count":0,"subtotal_cents":0,"currency":"AUD"}
```

`total_item_count` is the sum of quantities, not the number of distinct SKU lines. Existing SKU additions merge into one line. Server-side SKU prices determine subtotals.

### Try it

```sh
curl http://127.0.0.1:8000/api/products/everyday-tee
curl -i http://127.0.0.1:8000/api/cart/items \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: review-add-001' \
  -d '{"sku_id":"ocean-s","quantity":2}'
curl http://127.0.0.1:8000/api/cart
```

Repeat the exact POST to observe replay. For concurrency, `python -m pytest app/backend/tests -k concurrent -v` exercises two separate app instances/connections released by a barrier, both requesting Forest/M's final unit. Distinct keys yield one 201 and one 409; the same key yields two identical successful outcomes with one reservation.

## Engineering scope and limitations

- Local assets avoid remote image/service dependencies. Layout targets approximately 375px and 1280px; semantic buttons, fieldsets, labels, visible focus and live success/error regions support keyboard/assistive use. See verification notes for what was and was not visually tested.
- API, domain and UI concerns are in separate frontend files; Zod validates network responses at runtime in addition to TypeScript compile-time checks. No avoidable TypeScript `any` is used.
- Network calls have a ten-second timeout. A browser timeout does not cancel a committed server operation. If session storage is unavailable, in-page retry still retains its key, but recovery after closing/reloading the tab is limited; the UI asks users to keep an uncertain action open.
- Persistent keys have no cleanup, and carts have no expiry/remove endpoint. This is deliberately bounded to the requested API. Storage/API schema migrations, authentication and distributed deployment are not implemented.
- No real Xero credentials or customer data are included. Task C is a researched design answer; no invoice has been sent to Xero.
- AI assisted all deliverables. Read [the disclosure](docs/AI_DISCLOSURE.md); the candidate must personally review, run and be able to explain the code before submission.
