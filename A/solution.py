"""Deterministic, single-SKU reservation ledger. Run: python A/solution.py."""
from dataclasses import dataclass, field
import sys

LIMIT = 10**12


def integer(token: str, low: int, high: int) -> int:
    if not token.isascii() or not token.isdecimal():
        raise ValueError("expected an unsigned ASCII integer")
    value = int(token)
    if not low <= value <= high:
        raise ValueError("integer out of range")
    return value


def parse_command(line: str) -> tuple[str, str, str | None, int]:
    parts = line.split()
    if not parts or not all(p.isascii() and p.isprintable() for p in parts):
        raise ValueError("expected non-empty printable ASCII tokens")
    op = parts[0]
    if op == "RESTOCK" and len(parts) == 3:
        return op, parts[1], None, integer(parts[2], 1, LIMIT)
    if op in {"RESERVE", "RELEASE", "SHIP"} and len(parts) == 4:
        return op, parts[1], parts[2], integer(parts[3], 1, LIMIT)
    raise ValueError("unknown command or incorrect number of fields")


@dataclass
class Ledger:
    on_hand: int
    reserved: int = 0
    orders: dict[str, int] = field(default_factory=dict)
    processed: set[str] = field(default_factory=set)

    def process(self, line: str) -> str:
        try:
            op, event, order, qty = parse_command(line)
        except ValueError:
            # Invalid syntax does not claim an event ID; validation precedes replay.
            return self.result("REJECTED")
        if event in self.processed:
            return self.result("DUPLICATE")
        self.processed.add(event)
        held = self.orders.get(order, 0)
        if op == "RESTOCK":
            self.on_hand += qty
        elif op == "RESERVE":
            if qty > self.on_hand - self.reserved:
                return self.result("REJECTED")
            assert order is not None
            self.orders[order] = held + qty
            self.reserved += qty
        else:
            if qty > held:
                return self.result("REJECTED")
            assert order is not None
            self.reserved -= qty
            if op == "SHIP":
                self.on_hand -= qty
            if held == qty:
                del self.orders[order]
            else:
                self.orders[order] = held - qty
        return self.result("OK")

    def result(self, status: str) -> str:
        return f"{status} {self.on_hand} {self.reserved}"

    def open_lines(self) -> list[str]:
        return [f"OPEN {len(self.orders)}", *(
            f"{order} {self.orders[order]}" for order in sorted(self.orders)
        )]


def solve(text: str) -> str:
    lines = text.splitlines()
    if not lines or len(lines[0].split()) != 2:
        raise ValueError("first line must contain S N")
    s, n = lines[0].split()
    stock, count = integer(s, 0, LIMIT), integer(n, 1, 200_000)
    if len(lines) != count + 1:
        raise ValueError("command count does not match N")
    ledger = Ledger(stock)
    return "\n".join([*(ledger.process(line) for line in lines[1:]), *ledger.open_lines()])


if __name__ == "__main__":
    try:
        print(solve(sys.stdin.read()))
    except ValueError as exc:
        print(f"INPUT_ERROR: {exc}", file=sys.stderr)
        sys.exit(2)
