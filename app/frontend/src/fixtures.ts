import type { Cart, Product } from "./domain";

export const product: Product = {
  id: "everyday-tee",
  name: "The Everyday Tee",
  description: "Soft organic cotton.",
  currency: "AUD",
  options: [
    { id: "colour", name: "Colour", values: ["Ocean", "Clay", "Forest"] },
    { id: "size", name: "Size", values: ["S", "M", "L"] },
  ],
  skus: [
    {
      id: "ocean-s",
      price_cents: 3900,
      available_quantity: 8,
      image: "/images/ocean-s.svg",
      options: { colour: "Ocean", size: "S" },
    },
    {
      id: "ocean-m",
      price_cents: 3900,
      available_quantity: 12,
      image: "/images/ocean-m.svg",
      options: { colour: "Ocean", size: "M" },
    },
    {
      id: "ocean-l",
      price_cents: 4200,
      available_quantity: 4,
      image: "/images/ocean-l.svg",
      options: { colour: "Ocean", size: "L" },
    },
    {
      id: "clay-s",
      price_cents: 3900,
      available_quantity: 6,
      image: "/images/clay-s.svg",
      options: { colour: "Clay", size: "S" },
    },
    {
      id: "clay-m",
      price_cents: 3900,
      available_quantity: 0,
      image: "/images/clay-m.svg",
      options: { colour: "Clay", size: "M" },
    },
    {
      id: "forest-m",
      price_cents: 4100,
      available_quantity: 1,
      image: "/images/forest-m.svg",
      options: { colour: "Forest", size: "M" },
    },
  ],
};
export const emptyCart: Cart = {
  items: [],
  total_item_count: 0,
  subtotal_cents: 0,
  currency: "AUD",
};
export const addedCart: Cart = {
  items: [
    {
      sku_id: "ocean-s",
      quantity: 1,
      price_cents: 3900,
      colour: "Ocean",
      size: "S",
      image: "/images/ocean-s.svg",
    },
  ],
  total_item_count: 1,
  subtotal_cents: 3900,
  currency: "AUD",
};
