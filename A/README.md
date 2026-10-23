# Inventory reservation ledger

Run from the repository root:

```sh
python A/solution.py < A/example.in
python -m pytest A -q
```

Each order maps to its positive reserved quantity. A separate running total makes availability checks constant time. The set of processed event IDs includes every syntactically valid business request, whether accepted or rejected. A replay is identified **only by event ID**, including when its payload differs, as the example requires.

## Invariants and transitions

- `reserved == sum(orders.values())`, `0 <= reserved <= on_hand`.
- RESERVE: increase the order's reservation and total reserved only if enough stock remains.
- RELEASE: reduce the order and total reserved; on-hand stock is unchanged.
- SHIP: reduce the order, total reserved and on-hand by the same amount.
- RESTOCK: increase on-hand; it does not touch reservations.
- Zero-sized reservations are removed; failed operations change no stock/order state.

Parse and validate before touching any state, then check replay, then record the event and apply the business rule. A rejected business operation intentionally changes the processed-ID set, but not inventory. Initial stock and individual quantities are bounded by the specification; accumulated on-hand stock may exceed 10^12, which Python integers handle.

## Explicit input/output assumptions

The specification does not define a separate malformed-command output. This implementation prints `REJECTED on_hand reserved` for a malformed command and **does not consume an event ID**. Validation precedes replay: a malformed line with an already-used ID is still `REJECTED`. A corrected syntactically valid command may reuse the ID of a malformed line.

IDs are non-empty printable ASCII whitespace-delimited tokens (no control characters). Integers are unsigned ASCII decimal digits; leading zeroes are accepted. A bad header, out-of-range S/N, or wrong number of command lines rejects the entire input before execution: exit code 2, `INPUT_ERROR` on stderr and no stdout. A blank command line counts as one malformed command. One trailing newline is normal; additional blank lines count toward framing.

The final output is `OPEN K` followed by K lines `order_id reserved_quantity`, ordered by case-sensitive ASCII order ID. Only positive reservations appear. This extends the example's `OPEN 0` to the non-empty case, whose exact line format was unspecified.

## Complexity and tests

For N commands and K open orders, expected processing time is O(N) using Python hash maps/sets, plus O(K log K) final sorting. State space is O(N + K); the CLI also buffers input/output, O(N) lines. String hashing/parsing costs are proportional to input bytes; no identifier-length limit is invented. Hash operations are expected O(1), not an adversarial worst-case guarantee.

Tests cover the supplied example, rejection replay with a different payload, malformed atomicity, per-order limits, ordering, bad framing, random invariant preservation, 200,000 commands and large accumulated quantities.
