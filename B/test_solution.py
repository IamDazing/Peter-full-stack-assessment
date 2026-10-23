from itertools import product
import random
import pytest
from B.solution import Warehouse, optimise, solve


def exhaustive(warehouses, q):
    ordered = sorted(warehouses, key=lambda w: w.id)
    solutions = []
    for amounts in product(*(range(w.stock + 1) for w in ordered)):
        if sum(amounts) != q:
            continue
        alloc = [(w.id, n) for w, n in zip(ordered, amounts) if n]
        cost = sum(w.fixed_cost + n * w.unit_cost for w, n in zip(ordered, amounts) if n)
        solutions.append((len(alloc), cost, alloc))
    return min(solutions) if solutions else None


def test_example():
    assert solve("3 7\nAU 5 8 2\nCN 7 20 1\nUS 4 3 4\n") == "1 27\nCN 7"


def test_count_beats_cost():
    assert optimise([Warehouse("A", 2, 1000, 100), Warehouse("B", 1, 0, 0), Warehouse("C", 1, 0, 0)], 2) == (1, 1200, [("A", 2)])


def test_lexicographic_id_then_numeric_quantity():
    assert optimise([Warehouse("B", 12, 0, 1), Warehouse("A", 12, 0, 1)], 13) == (2, 13, [("A", 1), ("B", 12)])
    assert optimise([Warehouse("C", 2, 0, 1), Warehouse("B", 2, 0, 1), Warehouse("A", 2, 0, 1)], 3) == (2, 3, [("A", 1), ("B", 2)])


def test_zero_stock_and_impossible():
    assert solve("2 2\nA 0 0 0\nB 1 0 0") == "-1"
    assert solve("2 1\nA 0 0 0\nB 1 0 0") == "1 0\nB 1"


def test_random_against_independent_exhaustive_oracle():
    rng = random.Random(2026)
    for _ in range(500):
        ws = [Warehouse(chr(65+i), rng.randrange(5), rng.randrange(5), rng.randrange(4)) for i in range(rng.randrange(1, 6))]
        rng.shuffle(ws)
        q = rng.randrange(1, 12)
        assert optimise(ws, q) == exhaustive(ws, q)


def test_maximum_dimensions():
    ws = [Warehouse(f"W{i:02}", 2000, 10**6, 10**6) for i in range(30)]
    assert optimise(ws, 2000) == (1, 2_001_000_000, [("W00", 2000)])


def test_maximum_quantity_requires_every_warehouse():
    ws = [Warehouse(f"W{i:02}", 67, 0, 0) for i in range(30)]
    assert optimise(ws, 2000) == (30, 0, [("W00", 57)] + [(f"W{i:02}", 67) for i in range(1, 30)])


@pytest.mark.parametrize("text", ["", "31 1", "1 0\nA 1 0 0", "2 1\nA 1 0 0\nA 1 0 0", "1 1\nA -1 0 0", "1 1\nA 1 0", "1 1\nA 2001 0 0"])
def test_validation(text):
    with pytest.raises(ValueError):
        solve(text)
