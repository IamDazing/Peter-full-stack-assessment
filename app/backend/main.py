from contextlib import asynccontextmanager
import json
import logging
import os
from pathlib import Path
import sqlite3
from typing import Annotated
from uuid import uuid4

from fastapi import FastAPI, Header, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from starlette.exceptions import HTTPException

from .db import COLOURS, PRODUCT_ID, SIZES, cart_snapshot, connection, initialise

logger = logging.getLogger("assessment.api")


class AddItem(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    sku_id: str = Field(min_length=1, max_length=100, pattern=r"^[a-z0-9-]+$")
    quantity: int = Field(ge=1, le=1_000_000)


def error(code: str, message: str, **details) -> dict:
    return {"error": {"code": code, "message": message, "details": details}}


def create_app(db_path: str | None = None) -> FastAPI:
    path = db_path or os.environ.get("APP_DB_PATH") or str(Path(__file__).parent / "data" / "store.sqlite3")

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        initialise(path)
        yield

    api = FastAPI(title="Fieldwork Store API", version="1.0.0", lifespan=lifespan)

    @api.middleware("http")
    async def request_context(request: Request, call_next):
        request.state.request_id = str(uuid4())
        try:
            response = await call_next(request)
        except sqlite3.OperationalError:
            logger.warning("database_unavailable request_id=%s", request.state.request_id)
            response = JSONResponse(error("DATABASE_BUSY", "Storage is temporarily unavailable. Retry with the same request key."), status_code=503, headers={"Retry-After": "1"})
        except Exception:
            # Do not log bodies, headers, or exception strings that might contain input.
            logger.error("unexpected_failure request_id=%s", request.state.request_id)
            response = JSONResponse(error("INTERNAL_ERROR", "Something went wrong. Retry with the same request key."), status_code=500)
        response.headers["X-Request-ID"] = request.state.request_id
        response.headers["Cache-Control"] = "no-store"
        return response

    @api.exception_handler(RequestValidationError)
    async def invalid_input(_: Request, exc: RequestValidationError):
        fields = [{"field": ".".join(map(str, item["loc"])), "type": item["type"]} for item in exc.errors()]
        return JSONResponse(error("VALIDATION_ERROR", "Check the request fields and Idempotency-Key header.", fields=fields), status_code=422)

    @api.exception_handler(HTTPException)
    async def http_error(_: Request, exc: HTTPException):
        return JSONResponse(error("HTTP_ERROR", "The requested route or method is unavailable."), status_code=exc.status_code)

    @api.get("/api/products/{product_id}")
    def product(product_id: str):
        if product_id != PRODUCT_ID:
            return JSONResponse(error("PRODUCT_NOT_FOUND", "Product not found."), status_code=404)
        with connection(path) as conn:
            skus = [{"id": row["id"], "price_cents": row["price_cents"], "available_quantity": row["available_quantity"], "image": row["image"], "options": {"colour": row["colour"], "size": row["size"]}} for row in conn.execute("SELECT * FROM skus ORDER BY id")]
        return {"id": PRODUCT_ID, "name": "The Everyday Tee", "description": "A softer everyday essential. A relaxed silhouette in substantial organic cotton, made for wherever the day takes you.", "currency": "AUD", "options": [{"id": "colour", "name": "Colour", "values": COLOURS}, {"id": "size", "name": "Size", "values": SIZES}], "skus": skus}

    @api.get("/api/cart")
    def cart():
        with connection(path) as conn:
            return cart_snapshot(conn)

    @api.post("/api/cart/items", status_code=201)
    def add_item(body: AddItem, idempotency_key: Annotated[str, Header(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9._:-]+$")]):
        fingerprint = json.dumps(body.model_dump(), sort_keys=True, separators=(",", ":"))
        with connection(path) as conn:
            # This lock is shared by all connections/processes using this SQLite file.
            # All stock, cart and replay writes either commit together or roll back.
            conn.execute("BEGIN IMMEDIATE")
            prior = conn.execute("SELECT * FROM idempotency WHERE key=?", (idempotency_key,)).fetchone()
            if prior:
                if prior["fingerprint"] != fingerprint:
                    return JSONResponse(error("IDEMPOTENCY_CONFLICT", "This request key was already used for a different payload."), status_code=409)
                return JSONResponse(json.loads(prior["response"]), status_code=prior["status"], headers={"Idempotency-Replayed": "true"})

            sku = conn.execute("SELECT * FROM skus WHERE id=?", (body.sku_id,)).fetchone()
            if sku is None:
                status, result = 404, error("SKU_NOT_FOUND", "SKU not found.")
            else:
                changed = conn.execute("UPDATE skus SET available_quantity=available_quantity-? WHERE id=? AND available_quantity>=?", (body.quantity, body.sku_id, body.quantity)).rowcount
                if not changed:
                    status, result = 409, error("INSUFFICIENT_STOCK", "There is not enough stock for this quantity.", available_quantity=sku["available_quantity"])
                else:
                    conn.execute("INSERT INTO cart_items(sku_id, quantity) VALUES (?, ?) ON CONFLICT(sku_id) DO UPDATE SET quantity=cart_items.quantity+excluded.quantity", (body.sku_id, body.quantity))
                    status, result = 201, {"added": {"sku_id": body.sku_id, "quantity": body.quantity}, "remaining_stock": sku["available_quantity"] - body.quantity, "cart": cart_snapshot(conn)}
            # Cache definite business failures too. Validation / 5xx do not consume keys.
            conn.execute("INSERT INTO idempotency VALUES (?, ?, ?, ?)", (idempotency_key, fingerprint, status, json.dumps(result)))
            conn.commit()
            return JSONResponse(result, status_code=status, headers={"Idempotency-Replayed": "false"})

    return api


app = create_app()
