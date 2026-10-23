# Fulfilment split optimiser

```sh
python B/solution.py < B/example.in
python -m pytest B -q
```

## Objective and interpretation

Compare solutions by `(number_of_used_warehouses, total_cost, allocation_list)` in that order. The allocation list contains **only used** warehouses, sorted by ID; each element is `(warehouse_id, integer_quantity)`. Quantity comparison is numeric, not the textual order of printed digits. IDs are unique non-empty printable ASCII tokens, compared case-sensitively. A non-zero allocation incurs the warehouse's fixed fee exactly once. Malformed input exits 2 with `INPUT_ERROR` on stderr; a valid but impossible order prints `-1`.

## DP and bounded-window optimisation

Sort warehouses by ID. Let `D[i][q]` be the best pair `(count, cost)` for exactly q units using warehouses i through W−1. Impossible states are `None`; `D[W][0]=(0,0)`.

Skipping warehouse i gives `D[i+1][q]`. Taking t units, `1 <= t <= min(stock_i,q)`, gives:

```text
(D[i+1][q-t].count + 1,
 D[i+1][q-t].cost + fixed_i + t * unit_i)
```

Trying every t at every q would take O(WQ²). Substitute `p=q-t`. For a fixed q, a used warehouse adds the same `(1, fixed_i + q*unit_i)` to every candidate. Therefore compare:

```text
(D[i+1][p].count, D[i+1][p].cost - p*unit_i)
for p in [max(0, q-stock_i), q-1]
```

A monotone deque maintains the lexicographic minimum pair over this sliding window. A new candidate removes worse/equal candidates from the back; expired indices leave the front. Each p enters and leaves once per warehouse. Keeping the later candidate on an equal pair is safe for the numeric DP because it expires later; reconstruction below handles the final allocation tie separately. A zero-stock warehouse always has an empty positive-allocation window, so it can only be skipped.

## Correct reconstruction and tie-breaking

Keep all suffix DP rows. Visit warehouse IDs in increasing order. For each ID, try positive allocations t in ascending order, accepting the first one whose cost/count plus an optimal suffix equals the current optimum. If no positive t works, skip that warehouse.

Why this yields the lexicographically smallest used-only list:

1. If an optimal solution can use the current ID, its first pair is smaller than any optimal solution whose first used ID is later. At a positive remaining quantity, an empty completion is impossible.
2. Among optimal solutions using that ID, the smallest feasible t makes the first pair smallest.
3. Apply the same argument inductively to the remaining suffix.

For example, equal-cost two-warehouse solutions `[(A,1),(B,12)]` and `[(A,2),(B,11)]` favour the first. Storing a full zero-filled allocation vector and choosing its minimum would prefer skipping early IDs and can give the wrong answer.

## Complexity and verification

Sorting costs O(W log W). DP costs O(WQ) time and O(WQ) space. Reconstruction scans at most Q quantities per warehouse, so also O(WQ), with O(W) result space. At W=30 and Q=2,000 there are 62,031 DP cells including the terminal row. No external optimiser is used.

Tests compare 500 deterministic random small cases against an independent exhaustive allocation oracle. They also cover the supplied example, warehouse-count priority over shipping cost, ID and numeric-quantity ties, zero stock, impossible orders, invalid input and the maximum W/Q dimensions. The oracle is deliberately slow and test-only; production never enumerates subsets or allocations.
