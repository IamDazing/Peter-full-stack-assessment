import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { api, ApiError } from "./api";
import { addedCart, emptyCart, product } from "./fixtures";
import { readPending, savePending } from "./pending";

vi.mock("./api", async (importOriginal) => {
  const original = await importOriginal<typeof import("./api")>();
  return {
    ...original,
    api: { product: vi.fn(), cart: vi.fn(), add: vi.fn() },
  };
});

const addResult = {
  added: { sku_id: "ocean-s", quantity: 1 },
  remaining_stock: 7,
  cart: addedCart,
};
beforeEach(() => {
  vi.mocked(api.product)
    .mockReset()
    .mockResolvedValue(structuredClone(product));
  vi.mocked(api.cart).mockReset().mockResolvedValue(emptyCart);
  vi.mocked(api.add).mockReset().mockResolvedValue(addResult);
});

async function chooseOceanSmall() {
  const user = userEvent.setup();
  await screen.findByRole("heading", { name: "The Everyday Tee" });
  await user.click(screen.getByRole("button", { name: "Ocean" }));
  await user.click(screen.getByRole("button", { name: "Size S" }));
  return user;
}

describe("product page", () => {
  it("shows loading and retries a failed product request", async () => {
    vi.mocked(api.product).mockRejectedValueOnce(new Error("offline"));
    render(<App />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading");
    expect(await screen.findByRole("alert")).toHaveTextContent("couldn’t load");
    await userEvent.click(
      screen.getByRole("button", { name: "Retry loading" }),
    );
    expect(
      await screen.findByRole("heading", { name: "The Everyday Tee" }),
    ).toBeInTheDocument();
  });

  it("updates price/image, disables invalid combinations and clears an incompatible size", async () => {
    render(<App />);
    const user = await chooseOceanSmall();
    await user.click(screen.getByRole("button", { name: "Size L" }));
    expect(screen.getByLabelText("Selected price")).toHaveTextContent("$42.00");
    expect(
      screen.getByAltText("The Everyday Tee in Ocean, size L"),
    ).toHaveAttribute("src", "/images/ocean-l.svg");
    await user.click(screen.getByRole("button", { name: "Clay" }));
    expect(
      screen.getByRole("button", { name: "Size L, unavailable" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Size M, sold out" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: /Add to bag/ })).toBeDisabled();
    expect(screen.getByLabelText("Selected price")).toHaveTextContent("From");
  });

  it("clamps quantity when switching to a SKU with less stock", async () => {
    render(<App />);
    const user = await chooseOceanSmall();
    fireEvent.change(screen.getByRole("spinbutton"), {
      target: { value: "7" },
    });
    await user.click(screen.getByRole("button", { name: "Size M" }));
    await user.click(screen.getByRole("button", { name: "Forest" }));
    expect(screen.getByRole("spinbutton")).toHaveValue(1);
    expect(
      screen.getByRole("button", { name: "Increase quantity" }),
    ).toBeDisabled();
  });

  it("permits one request for duplicate clicks, then announces success", async () => {
    let finish!: (value: typeof addResult) => void;
    vi.mocked(api.add).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    render(<App />);
    await chooseOceanSmall();
    const button = screen.getByRole("button", { name: /Add to bag/ });
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(api.add).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /Adding/ })).toBeDisabled();
    vi.mocked(api.cart).mockResolvedValue(addedCart);
    await act(async () => finish(addResult));
    expect(
      await screen.findByText("1 item added to your bag."),
    ).toHaveAttribute("role", "status");
    expect(screen.getByLabelText("1 items in bag")).toBeInTheDocument();
    expect(readPending()).toBeNull();
  });

  it("retains the same key and payload after an uncertain network failure", async () => {
    vi.mocked(api.add)
      .mockRejectedValueOnce(new TypeError("network lost"))
      .mockResolvedValueOnce(addResult);
    render(<App />);
    const user = await chooseOceanSmall();
    await user.click(screen.getByRole("button", { name: /Add to bag/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "could not confirm",
    );
    expect(readPending()?.body).toEqual({ sku_id: "ocean-s", quantity: 1 });
    expect(screen.getByRole("button", { name: "Clay" })).toBeDisabled();
    await user.click(
      screen.getByRole("button", { name: "Retry previous addition" }),
    );
    await screen.findByText("1 item added to your bag.");
    expect(vi.mocked(api.add).mock.calls[0]).toEqual(
      vi.mocked(api.add).mock.calls[1],
    );
  });

  it("restores a pending request after reload even when the SKU is now sold out", async () => {
    savePending({ key: "recover", body: { sku_id: "clay-m", quantity: 1 } });
    vi.mocked(api.add).mockResolvedValue({
      ...addResult,
      added: { sku_id: "clay-m", quantity: 1 },
      remaining_stock: 0,
    });
    render(<App />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Retry previous addition" }),
    );
    expect(api.add).toHaveBeenCalledWith(
      { sku_id: "clay-m", quantity: 1 },
      "recover",
    );
    await screen.findByText("1 item added to your bag.");
  });

  it("handles fresher insufficient-stock data and allows selecting another SKU", async () => {
    vi.mocked(api.add).mockRejectedValueOnce(
      new ApiError(409, "INSUFFICIENT_STOCK", "There is not enough stock.", {
        available_quantity: 0,
      }),
    );
    render(<App />);
    const user = await chooseOceanSmall();
    const updated = structuredClone(product);
    updated.skus[0].available_quantity = 0;
    vi.mocked(api.product).mockResolvedValue(updated);
    await user.click(screen.getByRole("button", { name: /Add to bag/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "not enough stock",
    );
    expect(screen.getByRole("button", { name: "Sold out" })).toBeDisabled();
    expect(readPending()).toBeNull();
    await user.click(screen.getByRole("button", { name: "Size L" }));
    expect(screen.getByRole("button", { name: /Add to bag/ })).toBeEnabled();
  });

  it("keeps confirmed success distinct from failed background refresh", async () => {
    render(<App />);
    const user = await chooseOceanSmall();
    vi.mocked(api.product).mockRejectedValue(new Error("refresh failed"));
    await user.click(screen.getByRole("button", { name: /Add to bag/ }));
    expect(
      await screen.findByText("1 item added to your bag."),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "result above is confirmed",
    );
    vi.mocked(api.product).mockResolvedValue(product);
    await user.click(
      screen.getByRole("button", { name: "Refresh stock and bag" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    );
    expect(api.add).toHaveBeenCalledTimes(1);
  });

  it("treats 5xx as uncertain, but a 422 as a definite validation failure", async () => {
    vi.mocked(api.add).mockRejectedValueOnce(
      new ApiError(503, "DATABASE_BUSY", "Storage busy"),
    );
    render(<App />);
    const user = await chooseOceanSmall();
    await user.click(screen.getByRole("button", { name: /Add to bag/ }));
    expect(
      await screen.findByRole("button", { name: "Retry previous addition" }),
    ).toBeEnabled();
    vi.mocked(api.add).mockRejectedValueOnce(
      new ApiError(422, "VALIDATION_ERROR", "Check quantity."),
    );
    await user.click(
      screen.getByRole("button", { name: "Retry previous addition" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Check quantity",
    );
    expect(readPending()).toBeNull();
  });
});
