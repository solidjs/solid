// Action path: a cancellable checkout saga.
//
// `placeOrder` is a Solid action whose steps are Effect programs. Reads top
// to bottom like Effect.gen — but each `yield*` is also a transaction
// boundary: the optimistic status writes between steps commit atomically per
// step and auto-revert when the action settles. Cancel (or a typed decline)
// throws into the generator at the in-flight `yield*`; the catch block runs
// compensations *in reverse order of what actually committed* — refund the
// charge if it settled, release the inventory hold if it was placed — while
// Effect's own finalizers cover mid-step interruption (voiding a half-done
// authorization). UI rollback is free: optimistic writes revert on rejection.
//
// Note what's absent: no AbortController, no manual undo of UI state, no
// status flags to reset in a finally block.

import {
  createOptimistic,
  createOptimisticStore,
  createSignal,
  createStore,
  For,
  Loading,
  refresh,
  Show
} from "solid-js";
import {
  CardDeclinedError,
  chargeCard,
  createOrder,
  fetchOrders,
  refundCharge,
  releaseReservation,
  reserveInventory,
  type CartItem,
  type Charge,
  type Order,
  type Reservation
} from "./api";
import { ActionInterruptedError, effectAction } from "./solid-effect";

type Phase = "idle" | "reserving" | "charging" | "finalizing";

interface Notice {
  kind: "success" | "error" | "info";
  text: string;
}

const STEPS: { phase: Phase; label: string }[] = [
  { phase: "reserving", label: "Reserve inventory" },
  { phase: "charging", label: "Charge card" },
  { phase: "finalizing", label: "Create order" }
];

const INITIAL_CART: CartItem[] = [
  { id: "sku_signal", name: "Signal (fine-grained)", price: 19.99, quantity: 1 },
  { id: "sku_fiber", name: "Fiber (interruptible)", price: 24.5, quantity: 2 },
  { id: "sku_boundary", name: "Boundary (loading)", price: 9.75, quantity: 1 }
];

export function Checkout() {
  const [cart, setCart] = createStore<CartItem[]>(INITIAL_CART.map(i => ({ ...i })));
  const [orders] = createOptimisticStore<Order[]>(async () => fetchOrders(), []);

  // Transition-scoped: writes inside the action revert automatically when it
  // settles — success, failure, or cancellation.
  const [phase, setPhase] = createOptimistic<Phase>("idle");
  // Plain signal: survives the optimistic revert, carries the outcome.
  const [notice, setNotice] = createSignal<Notice | null>(null);
  const [declineCard, setDeclineCard] = createSignal(false);

  const total = () => cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

  const placeOrder = effectAction(function* (items: CartItem[], decline: boolean) {
    let reservation: Reservation | undefined;
    let charge: Charge | undefined;
    setNotice(null);
    try {
      setPhase("reserving");
      reservation = yield* reserveInventory(items);
      setPhase("charging");
      charge = yield* chargeCard(
        items.reduce((sum, item) => sum + item.price * item.quantity, 0),
        decline
      );
      setPhase("finalizing");
      const order = yield* createOrder(items, reservation, charge);
      setNotice({
        kind: "success",
        text: `Order ${order.id} confirmed — $${order.total.toFixed(2)}`
      });
      refresh(orders);
      return order;
    } catch (e) {
      // Saga compensation, in reverse order of what committed. Mid-step
      // cleanup (voiding a half-done authorization) already ran via the
      // interrupted step's own finalizers.
      if (charge) yield* refundCharge(charge);
      if (reservation) yield* releaseReservation(reservation);
      if (e instanceof CardDeclinedError) {
        setNotice({
          kind: "error",
          text: `Card declined for $${e.amount.toFixed(2)} — refunds/releases applied, cart untouched`
        });
      } else if (e instanceof ActionInterruptedError) {
        setNotice({ kind: "info", text: "Checkout cancelled — compensations ran, cart untouched" });
      }
      throw e; // reject the action → optimistic phase reverts to "idle"
    }
  });

  const inFlight = () => phase() !== "idle";
  const stepState = (step: Phase) => {
    const order: Phase[] = ["reserving", "charging", "finalizing"];
    const current = order.indexOf(phase());
    const target = order.indexOf(step);
    if (current === -1) return "";
    return target < current ? "done" : target === current ? "active" : "";
  };

  return (
    <section class="panel">
      <header>
        <h2>Checkout saga</h2>
        <p>
          Three Effect steps inside one Solid action transaction. Cancel mid-charge (it takes ~2.6s)
          or toggle the decline: the fiber is interrupted, compensations run server-side, and the
          optimistic UI reverts — automatically on both sides.
        </p>
      </header>

      <div class="cart">
        <For each={cart}>
          {(item, i) => (
            <div class="cart-row">
              <span class="cart-name">{item.name}</span>
              <span class="qty">
                <button
                  disabled={inFlight() || item.quantity <= 1}
                  onClick={() =>
                    setCart(c => {
                      c[i()].quantity--;
                    })
                  }
                >
                  −
                </button>
                {item.quantity}
                <button
                  disabled={inFlight()}
                  onClick={() =>
                    setCart(c => {
                      c[i()].quantity++;
                    })
                  }
                >
                  +
                </button>
              </span>
              <span class="cart-price">${(item.price * item.quantity).toFixed(2)}</span>
            </div>
          )}
        </For>
        <div class="cart-row total">
          <span class="cart-name">Total</span>
          <span class="cart-price">${total().toFixed(2)}</span>
        </div>
      </div>

      <div class="checkout-controls">
        <label class="decline-toggle">
          <input
            type="checkbox"
            checked={declineCard()}
            onInput={e => setDeclineCard(e.currentTarget.checked)}
          />
          Simulate card decline (typed <code>CardDeclinedError</code>)
        </label>
        <Show
          when={inFlight()}
          fallback={
            <button
              class="primary"
              onClick={() =>
                placeOrder(
                  cart.map(item => ({ ...item })),
                  declineCard()
                ).catch(() => {})
              }
            >
              Place order — ${total().toFixed(2)}
            </button>
          }
        >
          <button class="danger" onClick={() => placeOrder.interrupt()}>
            Cancel checkout
          </button>
        </Show>
      </div>

      <ol class="steps">
        <For each={STEPS}>
          {step => (
            <li
              class={{
                done: stepState(step.phase) === "done",
                active: stepState(step.phase) === "active"
              }}
            >
              {step.label}
            </li>
          )}
        </For>
      </ol>

      <Show when={notice()}>{n => <p class={`notice ${n().kind}`}>{n().text}</p>}</Show>

      <h3>Your orders</h3>
      <Loading fallback={<p class="loading">Loading orders…</p>}>
        <Show when={orders.length > 0} fallback={<p class="empty">No orders yet.</p>}>
          <ul class="orders">
            <For each={orders}>
              {order => (
                <li>
                  <span class="pkg-name">{order.id}</span>
                  <span class="pkg-desc">
                    {order.items.length} line{order.items.length === 1 ? "" : "s"} · placed{" "}
                    {order.placedAt}
                  </span>
                  <span class="cart-price">${order.total.toFixed(2)}</span>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </Loading>
    </section>
  );
}
