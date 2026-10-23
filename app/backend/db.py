"""SQLite transactions are the concurrency boundary, including idempotency."""
from contextlib import contextmanager
from pathlib import Path
import sqlite3

PRODUCT_ID = "everyday-tee"
COLOURS = ("Ocean", "Clay", "Forest")
SIZES = ("S", "M", "L")
SEED_SKUS = [
    ("ocean-s", "Ocean", "S", 3900, 8),
    ("ocean-m", "Ocean", "M", 3900, 12),
    ("ocean-l", "Ocean", "L", 4200, 4),
    ("clay-s", "Clay", "S", 3900, 6),
    ("clay-m", "Clay", "M", 3900, 0),
    # Clay/L does not exist; it is different from a sold-out SKU.
    ("forest-s", "Forest", "S", 4100, 5),
    ("forest-m", "Forest", "M", 4100, 1),
    ("forest-l", "Forest", "L", 4400, 3),
]


@contextmanager
def connection(path: str):
    conn = sqlite3.connect(path, timeout=5, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        yield conn
    finally:
        if conn.in_transaction:
            conn.rollback()
        conn.close()


def initialise(path: str) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with connection(path) as conn:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS skus (
            id TEXT PRIMARY KEY,
            colour TEXT NOT NULL,
            size TEXT NOT NULL,
            price_cents INTEGER NOT NULL CHECK(price_cents >= 0),
            available_quantity INTEGER NOT NULL CHECK(available_quantity >= 0),
            image TEXT NOT NULL,
            UNIQUE(colour, size)
        );
        CREATE TABLE IF NOT EXISTS cart_items (
            sku_id TEXT PRIMARY KEY REFERENCES skus(id),
            quantity INTEGER NOT NULL CHECK(quantity > 0)
        );
        CREATE TABLE IF NOT EXISTS idempotency (
            key TEXT PRIMARY KEY,
            fingerprint TEXT NOT NULL,
            status INTEGER NOT NULL,
            response TEXT NOT NULL
        );
        """)
        conn.execute("BEGIN IMMEDIATE")
        conn.executemany(
            "INSERT OR IGNORE INTO skus VALUES (?, ?, ?, ?, ?, ?)",
            [(*row, f"/images/{row[0]}.svg") for row in SEED_SKUS],
        )
        conn.commit()


def cart_snapshot(conn: sqlite3.Connection) -> dict:
    rows = conn.execute("""
        SELECT c.sku_id, c.quantity, s.price_cents, s.colour, s.size, s.image
        FROM cart_items c JOIN skus s ON s.id = c.sku_id ORDER BY c.sku_id
    """).fetchall()
    items = [dict(row) for row in rows]
    return {
        "items": items,
        "total_item_count": sum(row["quantity"] for row in rows),
        "subtotal_cents": sum(row["quantity"] * row["price_cents"] for row in rows),
        "currency": "AUD",
    }
