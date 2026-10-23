import { describe, expect, it } from "vitest";
import { boundedQuantity, resolveSku, sizeState } from "./domain";
import { product } from "./fixtures";

describe("variant resolution", () => {
  it("requires both dimensions and distinguishes a missing combination from a sold-out SKU", () => {
    expect(resolveSku(product, { colour: "Ocean", size: "" })).toBeUndefined();
    expect(resolveSku(product, { colour: "Clay", size: "L" })).toBeUndefined();
    expect(
      resolveSku(product, { colour: "Clay", size: "M" })?.available_quantity,
    ).toBe(0);
    expect(
      resolveSku(product, { colour: "Ocean", size: "L" })?.price_cents,
    ).toBe(4200);
  });
  it("marks unavailable and sold-out sizes separately", () => {
    expect(sizeState(product, "Clay", "L")).toBe("unavailable");
    expect(sizeState(product, "Clay", "M")).toBe("sold-out");
    expect(sizeState(product, "", "M")).toBe("available");
  });
  it("clamps quantities after stock or SKU changes", () => {
    expect(boundedQuantity(8, 1)).toBe(1);
    expect(boundedQuantity(-4, 10)).toBe(1);
    expect(boundedQuantity(NaN, 10)).toBe(1);
    expect(boundedQuantity(2.5, 10)).toBe(2);
  });
});
