from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
import sqlite3

from fastapi.testclient import TestClient
import pytest

from app.backend.main import create_app


@pytest.fixture
def setup(tmp_path):
    path = str(tmp_path / "test.sqlite3")
    with TestClient(create_app(path)) as client:
        yield client, path


def add(client, key="test", sku="ocean-s", quantity=1):
    return client.post("/api/cart/items", json={"sku_id": sku, "quantity": quantity}, headers={"Idempotency-Key": key})


def test_seed_and_success(setup):
    client, _ = setup
    p = client.get("/api/products/everyday-tee").json()
    assert len(p["skus"]) == 8
    assert any(s["available_quantity"] == 0 for s in p["skus"])
    assert not any(s["options"] == {"colour": "Clay", "size": "L"} for s in p["skus"])
    response = add(client, quantity=2)
    assert response.status_code == 201
    assert response.json()["remaining_stock"] == 6
    cart = client.get("/api/cart").json()
    assert cart["total_item_count"] == 2 and cart["subtotal_cents"] == 7800
    assert response.headers["x-request-id"]


@pytest.mark.parametrize("quantity", [0, -1, 1.5, "2", True, 1_000_001, None])
def test_strict_quantity_validation(setup, quantity):
    client, _ = setup
    assert add(client, quantity=quantity).status_code == 422
    assert client.get("/api/cart").json()["total_item_count"] == 0
    assert add(client).status_code == 201


def test_reject_client_price_missing_key_and_malformed_json(setup):
    client, _ = setup
    assert client.post("/api/cart/items", json={"sku_id": "ocean-s", "quantity": 1}).status_code == 422
    assert client.post("/api/cart/items", json={"sku_id": "ocean-s", "quantity": 1, "price_cents": 1}, headers={"Idempotency-Key": "key"}).status_code == 422
    r = client.post("/api/cart/items", content="{", headers={"Content-Type": "application/json", "Idempotency-Key": "key"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "VALIDATION_ERROR"


def test_replay_and_payload_conflict(setup):
    client, _ = setup
    first, second = add(client), add(client)
    assert first.json() == second.json()
    assert second.headers["Idempotency-Replayed"] == "true"
    assert add(client, quantity=2).json()["error"]["code"] == "IDEMPOTENCY_CONFLICT"
    assert client.get("/api/cart").json()["total_item_count"] == 1


def test_unknown_sku_and_business_rejection_are_cached(setup):
    client, path = setup
    assert add(client, "unknown", "not-real").status_code == 404
    first = add(client, "sold", "clay-m")
    assert first.status_code == 409 and first.json()["error"]["details"]["available_quantity"] == 0
    with sqlite3.connect(path) as conn:
        conn.execute("UPDATE skus SET available_quantity=2 WHERE id='clay-m'")
    assert add(client, "sold", "clay-m").json() == first.json()
    assert add(client, "new", "clay-m").status_code == 201


def test_cumulative_additions_cannot_over_reserve(setup):
    client, _ = setup
    assert add(client, "first", "ocean-l", 3).status_code == 201
    assert add(client, "second", "ocean-l", 2).status_code == 409
    assert client.get("/api/cart").json()["total_item_count"] == 3


@pytest.mark.parametrize("same_key", [False, True])
def test_concurrent_requests_on_separate_app_instances(setup, same_key):
    _, path = setup
    barrier = Barrier(2)
    with TestClient(create_app(path)) as c1, TestClient(create_app(path)) as c2:
        def request(client, key):
            barrier.wait(timeout=5)
            return add(client, key, "forest-m")
        with ThreadPoolExecutor(max_workers=2) as pool:
            f1 = pool.submit(request, c1, "a")
            f2 = pool.submit(request, c2, "a" if same_key else "b")
            responses = [f1.result(), f2.result()]
        assert sorted(r.status_code for r in responses) == ([201, 201] if same_key else [201, 409])
        if same_key:
            assert sorted(r.headers["Idempotency-Replayed"] for r in responses) == ["false", "true"]
        assert c1.get("/api/cart").json()["total_item_count"] == 1
        p = c1.get("/api/products/everyday-tee").json()
        assert next(s for s in p["skus"] if s["id"] == "forest-m")["available_quantity"] == 0


def test_restart_does_not_reseed_stock_or_lose_replay(setup):
    client, path = setup
    first = add(client, sku="forest-m")
    with TestClient(create_app(path)) as restarted:
        assert add(restarted, sku="forest-m").json() == first.json()
        assert add(restarted, "different", "forest-m").status_code == 409


def test_failure_rolls_back_stock_cart_and_key(setup):
    client, path = setup
    with sqlite3.connect(path) as conn:
        conn.execute("CREATE TRIGGER fail_cart BEFORE INSERT ON cart_items BEGIN SELECT RAISE(ABORT, 'simulated failure'); END")
    r = add(client)
    assert r.status_code == 500 and r.json()["error"]["code"] == "INTERNAL_ERROR"
    assert "simulated" not in r.text
    with sqlite3.connect(path) as conn:
        assert conn.execute("SELECT available_quantity FROM skus WHERE id='ocean-s'").fetchone()[0] == 8
        assert conn.execute("SELECT COUNT(*) FROM idempotency").fetchone()[0] == 0
        conn.execute("DROP TRIGGER fail_cart")
    assert add(client).status_code == 201


def test_not_found_is_structured(setup):
    client, _ = setup
    assert client.get("/api/products/unknown").status_code == 404
    assert client.get("/missing").json()["error"]["code"] == "HTTP_ERROR"
