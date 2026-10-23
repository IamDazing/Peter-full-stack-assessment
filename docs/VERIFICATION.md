# Verification and review notes

## Environment and executed checks

Verification date: **23 October 2026**. Local execution used Linux, Python 3.13.13, Node.js 24.16.0 and npm 11.13.0. Python 3.11 is the supported minimum and is included in the provided CI matrix; a hosted CI run and a Windows run have not been performed by the assistant.

The final dependency files were installed in a new Python virtual environment and a clean source copy (`pip install -r requirements.txt`, `npm ci`). The test runner is `python scripts/check.py`, which runs Python tests, frontend tests and TypeScript/production build checks.

- **51 Python tests:** Task A state/input/replay cases and large input; Task B supplied example, independent exhaustive comparison over 500 small random instances, ties, impossible orders and maximum dimensions; backend validation, persistence, rollback and concurrent stock/idempotency cases.
- **14 frontend tests:** domain resolution and quantity bounds; API request contract/runtime response validation; loading recovery, variant updates, quantity adjustment, duplicate click, network uncertainty, reload recovery, refreshed stock, confirmed success versus failed refresh, and 5xx/422 handling.
- **TypeScript strict check and Vite production build:** passed.
- **Real HTTP smoke:** documented two-service launcher, frontend HTML and transformed entry, all eight local SVGs, API proxy, product read, successful add, exact replay, new-key sold-out rejection and cart count. Uses an isolated temporary SQLite file and stops the started processes.
- **Dependency audit:** final `npm ci` reported zero known vulnerabilities at verification time. This is an advisory snapshot, not a security guarantee.
- **CLI samples:** the A and B outputs match the supplied examples.

The Python run emits one upstream deprecation warning: the current Starlette TestClient still accepts `httpx` but recommends `httpx2`. It does not fail tests or affect the application's request handling. npm may emit a transitive `whatwg-encoding` deprecation warning from the DOM test environment.

## Commands to reproduce

After following the root README setup:

```sh
python scripts/check.py
python A/solution.py < A/example.in
python B/solution.py < B/example.in
```

On macOS/Linux, with ports 8000 and 5173 free, run the optional end-to-end HTTP smoke (no browser required):

```sh
python scripts/smoke.py
```

The smoke test starts the actual services with a temporary database; it does not consume the normal demo database's stock. Windows users can use the normal test runner and manual checks below. The repository includes GitHub Actions configuration, but it will only produce a hosted run once pushed to a repository with Actions enabled.

## Verification limits

No controllable browser was available in the assistant environment. Therefore **real-browser visual inspection at 375px/1280px, a screen-reader pass and interactive browser acceptance testing were not performed**. The frontend was type-checked, built and exercised through jsdom interaction tests; HTML/assets/API were checked over HTTP. These are useful but do not prove rendered pixel layout or assistive-technology behaviour.

No real Xero account was connected. Task C is based on the current official documentation and OpenAPI specification, not live invoice creation or production integration results.

## Manual browser checklist

1. Start with fresh demo data and open the page at about 1280px, then 375px. Confirm no horizontal scrolling, clipped controls or overlapping text. Verify the illustration, price, options, quantity and bag controls remain readable.
2. With no selection, Add to bag is disabled. Select Ocean/S and observe $39.00, the Ocean illustration and eight available units. Select Ocean/L and verify $42.00 and four units.
3. Switch to Clay. L is unavailable, M is sold out, and an incompatible previous size is cleared. Choose Clay/S and confirm that adding is possible. Choose Ocean/M with quantity greater than one, then Forest/M; quantity should become one.
4. Add Ocean/S, open Bag and confirm quantity and subtotal. Click rapidly while a slow request is pending; there should be one addition for that action. Intentional later clicks should add more units with new keys.
5. Open a second tab and consume Forest/M's only unit. In a stale first tab attempt the same SKU. It should show the stock error, refresh availability and permit choosing another SKU without a page reload.
6. Use browser developer tools to simulate offline/slow requests. Initial load failure must offer Retry loading. An uncertain POST must offer Retry previous addition and retain its key/payload. Restore connectivity and retry; verify only one reservation. Refreshing the same tab while an operation is pending should preserve the recovery request. Storage access must be allowed for reload recovery.
7. Simulate a failed product/cart read after successful POST. The successful addition must stay successful and show a separate Refresh stock and bag action.
8. Use only Tab, Shift+Tab, Enter/Space and number-input keys. Confirm visible focus, labelled controls, option selection state, usable quantity bounds, success/error announcements and the skip link. Check with a screen reader if available.

These manual steps are a review checklist, not a record of tests already performed by the candidate.
