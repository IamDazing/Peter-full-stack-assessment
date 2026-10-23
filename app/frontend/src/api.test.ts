import { afterEach, expect, it, vi } from "vitest";
import { api } from "./api";
import { emptyCart } from "./fixtures";

afterEach(() => vi.unstubAllGlobals());
it("sends a stable idempotency header and only the intended payload", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(
      new Response(
        JSON.stringify({
          added: { sku_id: "ocean-s", quantity: 1 },
          remaining_stock: 7,
          cart: emptyCart,
        }),
        { status: 201 },
      ),
    );
  vi.stubGlobal("fetch", fetchMock);
  await api.add({ sku_id: "ocean-s", quantity: 1 }, "stable-key");
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/cart/items",
    expect.objectContaining({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "stable-key",
      },
      body: '{"sku_id":"ocean-s","quantity":1}',
    }),
  );
});
it("rejects a malformed success response instead of rendering invalid state", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response('{"items": []}', { status: 200 })),
  );
  await expect(api.cart()).rejects.toThrow();
});
