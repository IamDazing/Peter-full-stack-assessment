"""Bounded fulfilment DP with a monotone deque: O(WQ) time and space."""
from collections import deque
from dataclasses import dataclass
import sys


@dataclass(frozen=True)
class Warehouse:
    id: str
    stock: int
    fixed_cost: int
    unit_cost: int


def optimise(warehouses: list[Warehouse], quantity: int) -> tuple[int, int, list[tuple[str, int]]] | None:
    if not 1 <= len(warehouses) <= 30 or not 1 <= quantity <= 2000:
        raise ValueError("W or Q out of range")
    if len({w.id for w in warehouses}) != len(warehouses):
        raise ValueError("warehouse IDs must be unique")
    if any(not w.id or not w.id.isascii() or not w.id.isprintable() or any(c.isspace() for c in w.id)
           or not 0 <= w.stock <= 2000 or not 0 <= w.fixed_cost <= 10**6
           or not 0 <= w.unit_cost <= 10**6 for w in warehouses):
        raise ValueError("invalid warehouse")
    if sum(w.stock for w in warehouses) < quantity:
        return None
    ordered = sorted(warehouses, key=lambda w: w.id)
    # dp[i][q]: best (warehouse count, cost) using only warehouses i..W-1.
    dp: list[list[tuple[int, int] | None]] = [[None] * (quantity + 1) for _ in range(len(ordered) + 1)]
    dp[-1][0] = (0, 0)
    for i in range(len(ordered) - 1, -1, -1):
        w = ordered[i]
        following, current = dp[i + 1], dp[i]
        candidates: deque[tuple[int, tuple[int, int]]] = deque()
        for q in range(quantity + 1):
            p = q - 1
            if p >= 0 and following[p] is not None:
                count, cost = following[p]
                key = (count, cost - p * w.unit_cost)
                while candidates and candidates[-1][1] >= key:
                    candidates.pop()
                candidates.append((p, key))
            while candidates and candidates[0][0] < q - w.stock:
                candidates.popleft()
            best = following[q]  # Do not use this warehouse (no fixed fee).
            if candidates:
                count, cost = candidates[0][1]
                use = (count + 1, cost + w.fixed_cost + q * w.unit_cost)
                if best is None or use < best:
                    best = use
            current[q] = best

    optimum = dp[0][quantity]
    assert optimum is not None
    allocations: list[tuple[str, int]] = []
    remaining = quantity
    # For equal numeric objectives, prefer the earliest used ID, then its
    # smallest positive allocation. Suffix DP certifies optimal completion.
    for i, w in enumerate(ordered):
        if remaining == 0:
            break
        for take in range(1, min(w.stock, remaining) + 1):
            suffix = dp[i + 1][remaining - take]
            if suffix is not None and (suffix[0] + 1, suffix[1] + w.fixed_cost + take * w.unit_cost) == dp[i][remaining]:
                allocations.append((w.id, take))
                remaining -= take
                break
        else:
            assert dp[i][remaining] == dp[i + 1][remaining]
    assert remaining == 0
    return optimum[0], optimum[1], allocations


def solve(text: str) -> str:
    lines = text.splitlines()
    if not lines or len(lines[0].split()) != 2:
        raise ValueError("first line must contain W Q")
    def number(s: str) -> int:
        if not s.isascii() or not s.isdecimal():
            raise ValueError("expected unsigned ASCII integer")
        return int(s)
    count, quantity = map(number, lines[0].split())
    if len(lines) != count + 1:
        raise ValueError("warehouse count does not match W")
    warehouses = []
    for line in lines[1:]:
        fields = line.split()
        if len(fields) != 4:
            raise ValueError("expected warehouse_id stock fixed_cost unit_cost")
        warehouses.append(Warehouse(fields[0], *map(number, fields[1:])))
    result = optimise(warehouses, quantity)
    if result is None:
        return "-1"
    used, cost, allocations = result
    return "\n".join([f"{used} {cost}", *(f"{name} {qty}" for name, qty in allocations)])


if __name__ == "__main__":
    try:
        print(solve(sys.stdin.read()))
    except ValueError as exc:
        print(f"INPUT_ERROR: {exc}", file=sys.stderr)
        sys.exit(2)
