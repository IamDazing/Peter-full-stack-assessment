import { z } from "zod";

const cents = z.number().int().nonnegative();
export const skuSchema = z.object({
  id: z.string(),
  price_cents: cents,
  available_quantity: cents,
  image: z.string(),
  options: z.object({ colour: z.string(), size: z.string() }),
});
export const productSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  currency: z.literal("AUD"),
  options: z.array(
    z.object({
      id: z.enum(["colour", "size"]),
      name: z.string(),
      values: z.array(z.string()),
    }),
  ),
  skus: z.array(skuSchema).min(1),
});
export const cartSchema = z.object({
  items: z.array(
    z.object({
      sku_id: z.string(),
      quantity: cents,
      price_cents: cents,
      colour: z.string(),
      size: z.string(),
      image: z.string(),
    }),
  ),
  total_item_count: cents,
  subtotal_cents: cents,
  currency: z.literal("AUD"),
});
export const addResultSchema = z.object({
  added: z.object({ sku_id: z.string(), quantity: cents }),
  remaining_stock: cents,
  cart: cartSchema,
});
export type Product = z.infer<typeof productSchema>;
export type Sku = z.infer<typeof skuSchema>;
export type Cart = z.infer<typeof cartSchema>;
export type Selection = { colour: string; size: string };
export type AddPayload = { sku_id: string; quantity: number };

export function resolveSku(
  product: Product,
  selection: Selection,
): Sku | undefined {
  return product.skus.find(
    (s) =>
      s.options.colour === selection.colour &&
      s.options.size === selection.size,
  );
}

// Selection is hierarchical: colour stays selectable so users cannot get
// trapped in a size that is unavailable in another colour. Size is filtered.
export function sizeState(
  product: Product,
  colour: string,
  size: string,
): "available" | "sold-out" | "unavailable" {
  const matches = product.skus.filter(
    (s) => s.options.size === size && (!colour || s.options.colour === colour),
  );
  if (!matches.length) return "unavailable";
  return matches.some((s) => s.available_quantity > 0)
    ? "available"
    : "sold-out";
}

export function boundedQuantity(value: number, stock: number): number {
  return Math.max(
    1,
    Math.min(
      Number.isFinite(value) ? Math.trunc(value) : 1,
      Math.max(1, stock),
    ),
  );
}

export function money(centsValue: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
  }).format(centsValue / 100);
}
