import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";
import {
  boundedQuantity,
  money,
  resolveSku,
  sizeState,
  type Cart,
  type Product,
  type Selection,
} from "./domain";
import { readPending, savePending, type Pending } from "./pending";

type Feedback = { kind: "success" | "error"; text: string } | null;

export default function App() {
  const [product, setProduct] = useState<Product | null>(null);
  const [cart, setCart] = useState<Cart | null>(null);
  const [load, setLoad] = useState<"loading" | "ready" | "error">("loading");
  const [loadVersion, setLoadVersion] = useState(0);
  const [selection, setSelection] = useState<Selection>({
    colour: "",
    size: "",
  });
  const [quantity, setQuantity] = useState(1);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(readPending);
  const pendingRef = useRef(pending);
  const inFlight = useRef(false);
  const refreshGeneration = useRef(0);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [refreshWarning, setRefreshWarning] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);

  useEffect(() => {
    let active = true;
    setLoad("loading");
    Promise.all([api.product(), api.cart()])
      .then(([nextProduct, nextCart]) => {
        if (!active) return;
        setProduct(nextProduct);
        setCart(nextCart);
        setLoad("ready");
        const recovery = pendingRef.current;
        if (recovery) {
          const sku = nextProduct.skus.find(
            (s) => s.id === recovery.body.sku_id,
          );
          if (sku) setSelection(sku.options);
          setQuantity(recovery.body.quantity);
        }
      })
      .catch(() => {
        if (active) setLoad("error");
      });
    return () => {
      active = false;
    };
  }, [loadVersion]);

  const selected = product ? resolveSku(product, selection) : undefined;
  const stock = selected?.available_quantity ?? 0;
  const validQuantity =
    Number.isInteger(quantity) && quantity >= 1 && quantity <= stock;
  useEffect(() => {
    if (!pendingRef.current) setQuantity((q) => boundedQuantity(q, stock));
  }, [stock, selected?.id]);

  async function refresh() {
    const generation = ++refreshGeneration.current;
    const [nextProduct, nextCart] = await Promise.allSettled([
      api.product(),
      api.cart(),
    ]);
    if (generation !== refreshGeneration.current) return;
    if (nextProduct.status === "fulfilled") setProduct(nextProduct.value);
    if (nextCart.status === "fulfilled") setCart(nextCart.value);
    setRefreshWarning(
      nextProduct.status === "rejected" || nextCart.status === "rejected",
    );
  }

  function remember(value: Pending | null) {
    pendingRef.current = value;
    setPending(value);
    savePending(value);
  }

  function chooseColour(colour: string) {
    if (!product) return;
    // Clear incompatible size instead of leaving a stale SKU/price selected.
    const size =
      sizeState(product, colour, selection.size) === "available"
        ? selection.size
        : "";
    setSelection({ colour, size });
    setFeedback(null);
  }

  async function addToCart() {
    // A ref closes the double-click window before React commits disabled=true.
    if (inFlight.current) return;
    const recovery = pendingRef.current;
    if (!recovery && (!selected || !validQuantity || stock === 0)) return;
    const request = recovery ?? {
      key: crypto.randomUUID(),
      body: { sku_id: selected!.id, quantity },
    };
    inFlight.current = true;
    ++refreshGeneration.current;
    setBusy(true);
    setFeedback(null);
    setRefreshWarning(false);
    remember(request);
    try {
      const result = await api.add(request.body, request.key);
      setCart(result.cart);
      setProduct((current) =>
        current
          ? {
              ...current,
              skus: current.skus.map((s) =>
                s.id === result.added.sku_id
                  ? { ...s, available_quantity: result.remaining_stock }
                  : s,
              ),
            }
          : current,
      );
      remember(null);
      setFeedback({
        kind: "success",
        text: `${result.added.quantity} ${result.added.quantity === 1 ? "item" : "items"} added to your bag.`,
      });
      // Replays contain historical snapshots. Always reconcile with current reads.
      await refresh();
    } catch (err: unknown) {
      if (
        err instanceof ApiError &&
        err.status >= 400 &&
        err.status < 500 &&
        err.status !== 408 &&
        err.status !== 429
      ) {
        remember(null);
        if (
          err.code === "INSUFFICIENT_STOCK" &&
          typeof err.details.available_quantity === "number"
        ) {
          const available = err.details.available_quantity;
          setProduct((current) =>
            current
              ? {
                  ...current,
                  skus: current.skus.map((s) =>
                    s.id === request.body.sku_id
                      ? { ...s, available_quantity: available }
                      : s,
                  ),
                }
              : current,
          );
        }
        setFeedback({ kind: "error", text: err.message });
        await refresh();
      } else {
        // A timeout or 5xx cannot prove whether a reservation committed.
        setFeedback({
          kind: "error",
          text: "We could not confirm your addition. Retry the same request below; the item will not be added twice. Keep this page open until it is resolved.",
        });
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const complete = Boolean(selection.colour && selection.size);
  const imageSku =
    selected ??
    product?.skus.find((s) => s.options.colour === selection.colour) ??
    product?.skus[0];
  const price = selected
    ? money(selected.price_cents)
    : product
      ? `From ${money(Math.min(...product.skus.map((s) => s.price_cents)))}`
      : "";
  const stockLabel = !complete
    ? "Choose a colour and size"
    : !selected
      ? "This combination is unavailable"
      : stock === 0
        ? "Sold out in this combination"
        : `${stock} available · ready for your next everyday`;

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to product
      </a>
      <div className="announcement">THOUGHTFUL ESSENTIALS. EVERY DAY.</div>
      <header className="site-header">
        <a className="wordmark" href="/" aria-label="Fieldwork home">
          fieldwork<span>®</span>
        </a>
        <span className="header-note">Made for the everyday.</span>
        <button
          className="bag-button"
          aria-expanded={cartOpen}
          aria-controls="shopping-bag"
          onClick={() => setCartOpen(!cartOpen)}
        >
          <svg
            width="19"
            height="22"
            viewBox="0 0 19 22"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M2 7h15l1 13H1L2 7Z M6 8V5a3.5 3.5 0 0 1 7 0v3"
              stroke="currentColor"
              strokeWidth="1.4"
            />
          </svg>
          Bag{" "}
          <span
            className="bag-count"
            aria-label={`${cart?.total_item_count ?? 0} items in bag`}
          >
            {cart?.total_item_count ?? 0}
          </span>
        </button>
      </header>
      <main id="main">
        {load === "loading" && (
          <div className="page-message" role="status">
            <span className="spinner" />
            Loading the everyday essentials…
          </div>
        )}
        {load === "error" && (
          <div className="page-message">
            <h1>Let’s try that again.</h1>
            <p role="alert">
              We couldn’t load the product and your bag. Check your connection
              and retry.
            </p>
            <button
              className="primary"
              onClick={() => setLoadVersion((v) => v + 1)}
            >
              Retry loading
            </button>
          </div>
        )}
        {load === "ready" && product && (
          <>
            <nav className="breadcrumb" aria-label="Breadcrumb">
              The collection <span>/</span> Everyday essentials <span>/</span>{" "}
              <span aria-current="page">The Everyday Tee</span>
            </nav>
            <div className="product-layout">
              <section className="gallery" aria-label="Product images">
                <div className="product-image">
                  <span className="image-label">
                    THE EVERYDAY COLLECTION / 01
                  </span>
                  <img
                    src={imageSku?.image}
                    alt={`The Everyday Tee in ${imageSku?.options.colour ?? "Ocean"}${selected ? `, size ${selected.options.size}` : ""}`}
                  />
                  <span className="image-caption">
                    A little less, a little better.
                  </span>
                </div>
                <div className="gallery-caption">
                  <span>100% organic cotton</span>
                  <span>Designed to be lived in ↗</span>
                </div>
              </section>
              <section
                className="product-details"
                aria-labelledby="product-title"
              >
                <p className="eyebrow">YOUR NEW DAILY ROTATION</p>
                <h1 id="product-title">{product.name}</h1>
                <div className="price-row">
                  <p className="price" aria-label="Selected price">
                    {price}
                  </p>
                  <span>AUD · GST included</span>
                </div>
                <p className="description">{product.description}</p>
                <div className="product-form">
                  <fieldset disabled={busy || Boolean(pending)}>
                    <legend>
                      Colour{" "}
                      <span>{selection.colour || "Select a colour"}</span>
                    </legend>
                    <div className="colour-options">
                      {product.options
                        .find((o) => o.id === "colour")
                        ?.values.map((colour) => (
                          <button
                            key={colour}
                            className={`colour-option ${selection.colour === colour ? "selected" : ""}`}
                            aria-pressed={selection.colour === colour}
                            onClick={() => chooseColour(colour)}
                          >
                            <span
                              className={`swatch swatch-${colour.toLowerCase()}`}
                            />
                            {colour}
                          </button>
                        ))}
                    </div>
                  </fieldset>
                  <fieldset disabled={busy || Boolean(pending)}>
                    <legend>
                      Size <span>{selection.size || "Select your size"}</span>
                    </legend>
                    <div className="size-options">
                      {product.options
                        .find((o) => o.id === "size")
                        ?.values.map((size) => {
                          const availability = sizeState(
                            product,
                            selection.colour,
                            size,
                          );
                          return (
                            <button
                              key={size}
                              className={
                                selection.size === size ? "selected" : ""
                              }
                              disabled={availability !== "available"}
                              aria-pressed={selection.size === size}
                              aria-label={`Size ${size}${availability === "available" ? "" : `, ${availability === "sold-out" ? "sold out" : "unavailable"}`}`}
                              title={
                                availability === "available"
                                  ? `Size ${size}`
                                  : availability === "sold-out"
                                    ? "Sold out"
                                    : "Not made in this colour"
                              }
                              onClick={() => {
                                setSelection((s) => ({ ...s, size }));
                                setFeedback(null);
                              }}
                            >
                              {size}
                              {availability !== "available" && (
                                <small>
                                  {availability === "sold-out"
                                    ? "Sold out"
                                    : "Unavailable"}
                                </small>
                              )}
                            </button>
                          );
                        })}
                    </div>
                  </fieldset>
                  <p
                    className={`stock-status ${selected && stock > 0 ? "in-stock" : ""}`}
                    role="status"
                  >
                    <span />
                    {stockLabel}
                  </p>
                  <div className="purchase-row">
                    <div className="quantity">
                      <label htmlFor="quantity">Quantity</label>
                      <div>
                        <button
                          aria-label="Decrease quantity"
                          disabled={
                            busy ||
                            Boolean(pending) ||
                            !selected ||
                            stock === 0 ||
                            quantity <= 1
                          }
                          onClick={() => setQuantity((q) => q - 1)}
                        >
                          −
                        </button>
                        <input
                          id="quantity"
                          type="number"
                          min="1"
                          max={Math.max(1, stock)}
                          value={Number.isNaN(quantity) ? "" : quantity}
                          disabled={
                            busy || Boolean(pending) || !selected || stock === 0
                          }
                          aria-invalid={
                            selected && stock > 0 ? !validQuantity : undefined
                          }
                          onChange={(e) => setQuantity(e.target.valueAsNumber)}
                          onBlur={() =>
                            setQuantity((q) => boundedQuantity(q, stock))
                          }
                        />
                        <button
                          aria-label="Increase quantity"
                          disabled={
                            busy ||
                            Boolean(pending) ||
                            !selected ||
                            stock === 0 ||
                            quantity >= stock ||
                            !validQuantity
                          }
                          onClick={() => setQuantity((q) => q + 1)}
                        >
                          +
                        </button>
                      </div>
                    </div>
                    <button
                      className="primary add-button"
                      disabled={
                        busy ||
                        (!pending &&
                          (!selected || !validQuantity || stock === 0))
                      }
                      onClick={() => void addToCart()}
                    >
                      {busy ? (
                        <>
                          <span className="spinner" />
                          Adding…
                        </>
                      ) : pending ? (
                        "Retry previous addition"
                      ) : selected && stock === 0 ? (
                        "Sold out"
                      ) : (
                        "Add to bag"
                      )}
                      {!busy && !pending && <span aria-hidden="true">↗</span>}
                    </button>
                  </div>
                  {pending && !busy && (
                    <p className="pending-note">
                      An earlier addition needs confirmation:{" "}
                      {pending.body.quantity} × {pending.body.sku_id}. Retry it
                      before starting another.
                    </p>
                  )}
                  {feedback && (
                    <p
                      className={`feedback ${feedback.kind}`}
                      role={feedback.kind === "error" ? "alert" : "status"}
                    >
                      {feedback.text}
                    </p>
                  )}
                  {refreshWarning && (
                    <div className="feedback error" role="alert">
                      The result above is confirmed, but live stock or bag
                      details could not refresh.{" "}
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => void refresh()}
                      >
                        Refresh stock and bag
                      </button>
                    </div>
                  )}
                </div>
                <div className="product-notes">
                  <p>
                    <span aria-hidden="true">◇</span> Soft by nature. Made to
                    last.
                  </p>
                  <p>
                    <span aria-hidden="true">↔</span> Relaxed fit. Room to
                    move.
                  </p>
                </div>
                <details>
                  <summary>Fabric & care</summary>
                  <p>
                    100% organic cotton, 220 gsm. Cold wash with similar
                    colours. Line dry in the shade. A little care goes a long
                    way.
                  </p>
                </details>
                <details>
                  <summary>Finding your fit</summary>
                  <p>
                    A relaxed, unisex cut. Chest widths measured flat: S 50 cm,
                    M 54 cm, L 58 cm. Compare with a tee you already love.
                  </p>
                </details>
              </section>
            </div>
            <section className="closing-note">
              <p>FEWER, BETTER THINGS.</p>
              <h2>Good days start with the basics.</h2>
              <span>Considered colours. An easy fit. Nothing extra.</span>
            </section>
          </>
        )}
        <section
          id="shopping-bag"
          className="cart-panel"
          hidden={!cartOpen}
          aria-label="Your bag"
        >
          <div className="cart-heading">
            <h2>Your bag</h2>
            <button className="text-button" onClick={() => setCartOpen(false)}>
              Close bag
            </button>
          </div>
          {cart?.items.length ? (
            <>
              <ul>
                {cart.items.map((item) => (
                  <li key={item.sku_id}>
                    <img src={item.image} alt="" />
                    <span>
                      <strong>Everyday Tee</strong>
                      <br />
                      {item.colour} / {item.size}
                      <br />
                      Qty {item.quantity}
                    </span>
                    <span>{money(item.quantity * item.price_cents)}</span>
                  </li>
                ))}
              </ul>
              <p className="cart-total">
                Subtotal <strong>{money(cart.subtotal_cents)}</strong>
              </p>
            </>
          ) : (
            <p>Your bag is waiting for something good.</p>
          )}
          <p className="cart-footnote">
            Demo store · Items are reserved when added. Checkout is outside this
            demo.
          </p>
        </section>
      </main>
      <footer>
        <span className="wordmark">
          fieldwork<span>®</span>
        </span>
        <p>Everyday essentials, thoughtfully considered.</p>
        <span>ASSESSMENT DEMO · 2026</span>
      </footer>
    </>
  );
}
