import random
import pytest
from A.solution import Ledger, solve


def test_example():
    assert solve("10 6\nRESERVE e1 o100 4\nRESERVE e2 o200 7\nSHIP e3 o100 2\nRELEASE e4 o100 2\nRESTOCK e5 3\nRESERVE e2 o999 1\n") == (
        "OK 10 4\nREJECTED 10 4\nOK 8 2\nOK 8 0\nOK 11 0\nDUPLICATE 11 0\nOPEN 0"
    )


def test_rejected_event_is_processed_even_when_payload_changes():
    ledger = Ledger(0)
    assert ledger.process("RESERVE e1 a 1") == "REJECTED 0 0"
    ledger.process("RESTOCK e2 5")
    assert ledger.process("RESTOCK e1 99") == "DUPLICATE 5 0"


@pytest.mark.parametrize("bad", ["RESERVE e a 0", "SHIP e a -1", "RESTOCK e 1.5", "RESTOCK e ١", "RESERVE e a", "DELETE e a 1", "RESTOCK é 1", "RESTOCK e 1000000000001", ""])
def test_malformed_is_atomic_and_does_not_claim_event(bad):
    ledger = Ledger(10)
    ledger.process("RESERVE initial a 3")
    before = (ledger.on_hand, ledger.reserved, ledger.orders.copy(), ledger.processed.copy())
    assert ledger.process(bad).startswith("REJECTED")
    assert (ledger.on_hand, ledger.reserved, ledger.orders, ledger.processed) == before


def test_per_order_limits_and_open_ordering():
    ledger = Ledger(10)
    ledger.process("RESERVE a z 4")
    ledger.process("RESERVE b a 2")
    assert ledger.process("SHIP c a 3") == "REJECTED 10 6"
    assert ledger.process("RELEASE d missing 1") == "REJECTED 10 6"
    assert ledger.open_lines() == ["OPEN 2", "a 2", "z 4"]
    assert ledger.process("SHIP e z 4") == "OK 6 2"
    assert ledger.open_lines() == ["OPEN 1", "a 2"]


@pytest.mark.parametrize("data", ["", "1", "-1 1\nRESTOCK a 1", "1 2\nRESTOCK a 1", "1 1\nRESTOCK a 1\nRESTOCK b 1", "1 0"])
def test_invalid_framing(data):
    with pytest.raises(ValueError):
        solve(data)


def test_random_invariants_and_replays():
    rng = random.Random(17)
    ledger = Ledger(100)
    for i in range(3000):
        op = rng.choice(["RESERVE", "SHIP", "RELEASE", "RESTOCK"])
        line = f"{op} e{i} " + ("" if op == "RESTOCK" else f"o{rng.randrange(10)} ") + str(rng.randrange(1, 30))
        ledger.process(line)
        before = (ledger.on_hand, ledger.reserved, ledger.orders.copy())
        assert ledger.process(line).startswith("DUPLICATE")
        assert (ledger.on_hand, ledger.reserved, ledger.orders) == before
        assert 0 <= ledger.reserved == sum(ledger.orders.values()) <= ledger.on_hand
        assert all(q > 0 for q in ledger.orders.values())


def test_large_values_and_command_count():
    ledger = Ledger(10**12)
    for i in range(200_000):
        ledger.process(f"RESTOCK e{i} 1000000000000")
    assert ledger.on_hand == 200_001 * 10**12
