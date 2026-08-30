// Fake backends written as Effect programs. This is the Effect half of the
// demo: typed errors (Data.TaggedError), declarative retry/timeout policies,
// and interruption finalizers (onInterrupt) — all declared on the program,
// none of it visible to the Solid components that consume them.

import { Data, Effect, Schedule } from "effect";
import { log } from "./log";

// ---------------------------------------------------------------------------
// Search (read path)
// ---------------------------------------------------------------------------

export interface Package {
  name: string;
  description: string;
  downloads: number;
}

export class TransientNetworkError extends Data.TaggedError("TransientNetwork")<{
  query: string;
}> {}

const REGISTRY: Package[] = [
  { name: "solid-js", description: "Fine-grained reactive UI library", downloads: 1_450_000 },
  { name: "@solidjs/web", description: "Solid web platform runtime", downloads: 1_310_000 },
  { name: "@solidjs/signals", description: "Standalone reactive primitives", downloads: 890_000 },
  { name: "@solidjs/router", description: "Universal router for Solid", downloads: 640_000 },
  { name: "@solidjs/start", description: "Fullstack Solid meta-framework", downloads: 410_000 },
  { name: "@solidjs/meta", description: "Document head management", downloads: 350_000 },
  { name: "solid-devtools", description: "Reactivity graph devtools", downloads: 120_000 },
  { name: "solid-transition-group", description: "Enter/exit animations", downloads: 95_000 },
  { name: "effect", description: "Typed functional effect system", downloads: 980_000 },
  { name: "@effect/platform", description: "Cross-platform runtime services", downloads: 420_000 },
  {
    name: "@effect/schema",
    description: "Schema validation and transformation",
    downloads: 510_000
  },
  { name: "@effect/cli", description: "Declarative command-line apps", downloads: 88_000 },
  {
    name: "@effect-atom/atom-solid",
    description: "Effect Atom bindings for Solid 1.x",
    downloads: 12_000
  },
  { name: "vite", description: "Next generation frontend tooling", downloads: 12_400_000 },
  { name: "vitest", description: "Vite-native test runner", downloads: 6_200_000 },
  { name: "vinxi", description: "Full-stack JS SDK on Nitro + Vite", downloads: 380_000 },
  { name: "seroval", description: "Universal value serialization", downloads: 1_100_000 },
  { name: "typescript", description: "Typed superset of JavaScript", downloads: 48_000_000 },
  { name: "esbuild", description: "Extremely fast bundler", downloads: 32_000_000 },
  { name: "rollup", description: "Module bundler for libraries", downloads: 21_000_000 },
  { name: "terser", description: "JavaScript mangler and compressor", downloads: 19_000_000 },
  { name: "prettier", description: "Opinionated code formatter", downloads: 27_000_000 },
  { name: "zod", description: "TypeScript-first schema validation", downloads: 14_000_000 },
  { name: "hono", description: "Small, fast web framework", downloads: 2_100_000 },
  { name: "nitro", description: "Universal server toolkit", downloads: 950_000 },
  { name: "oxc-parser", description: "Rust-based JS/TS parser", downloads: 260_000 },
  { name: "turbo", description: "Incremental monorepo build system", downloads: 3_400_000 },
  { name: "pnpm", description: "Fast, disk-efficient package manager", downloads: 8_900_000 }
];

/** Chance a single search attempt fails with a transient error (retried). */
export const SEARCH_FLAKINESS = 0.35;

/**
 * Search the fake registry. The program:
 *  - carries realistic latency,
 *  - fails transiently ~35% of the time, retried up to 3 times with
 *    exponential backoff (typed `while` — only TransientNetwork retries),
 *  - times out at 4s,
 *  - logs interruption via a finalizer, which is what fires when Solid
 *    supersedes the flight and `runEffect` interrupts the fiber.
 */
export function searchPackages(query: string) {
  const attempt = Effect.gen(function* () {
    yield* Effect.sleep(250 + Math.random() * 550);
    if (Math.random() < SEARCH_FLAKINESS) {
      yield* Effect.sync(() =>
        log("retry", `search "${query}" hit a transient error — retrying with backoff`)
      );
      return yield* new TransientNetworkError({ query });
    }
    const q = query.toLowerCase();
    return REGISTRY.filter(
      p => p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)
    ).sort((a, b) => b.downloads - a.downloads);
  });

  return Effect.gen(function* () {
    yield* Effect.sync(() => log("start", `search "${query}" — fiber started`));
    return yield* attempt.pipe(
      Effect.retry({
        schedule: Schedule.exponential(150),
        times: 3,
        while: e => e._tag === "TransientNetwork"
      })
    );
  }).pipe(
    Effect.timeout(4000),
    Effect.tap(results =>
      Effect.sync(() => log("success", `search "${query}" → ${results.length} results`))
    ),
    Effect.tapError(e =>
      Effect.sync(() => log("error", `search "${query}" failed for good: ${e._tag}`))
    ),
    Effect.onInterrupt(() =>
      Effect.sync(() =>
        log("interrupt", `search "${query}" interrupted — fiber + pending retries torn down`)
      )
    )
  );
}

// ---------------------------------------------------------------------------
// Checkout (action path)
// ---------------------------------------------------------------------------

export interface CartItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
}

export interface Reservation {
  id: string;
  items: CartItem[];
}

export interface Charge {
  id: string;
  amount: number;
}

export interface Order {
  id: string;
  items: CartItem[];
  total: number;
  placedAt: string;
}

export class CardDeclinedError extends Data.TaggedError("CardDeclined")<{
  amount: number;
}> {}

// Module-level "database" for placed orders.
let ORDERS: Order[] = [];
let seq = 0;

export function fetchOrders(): Promise<Order[]> {
  return Effect.runPromise(Effect.sleep(300).pipe(Effect.map(() => ORDERS.map(o => ({ ...o })))));
}

/** Step 1 — hold inventory. ~900ms. */
export function reserveInventory(items: CartItem[]) {
  return Effect.gen(function* () {
    yield* Effect.sync(() => log("start", "reserveInventory — placing hold"));
    yield* Effect.sleep(900);
    const reservation: Reservation = { id: `rsv_${++seq}`, items };
    yield* Effect.sync(() => log("success", `reserveInventory → ${reservation.id} held`));
    return reservation;
  }).pipe(
    Effect.onInterrupt(() =>
      Effect.sync(() => log("interrupt", "reserveInventory interrupted — no hold placed"))
    )
  );
}

/** Compensation for step 1 — release a hold that was successfully placed. */
export function releaseReservation(reservation: Reservation) {
  return Effect.gen(function* () {
    yield* Effect.sleep(400);
    yield* Effect.sync(() =>
      log("compensate", `releaseReservation → ${reservation.id} released (saga compensation)`)
    );
  });
}

/** Compensation for step 2 — refund a charge that fully settled (the
 * mid-flight case is covered by chargeCard's own onInterrupt finalizer). */
export function refundCharge(charge: Charge) {
  return Effect.gen(function* () {
    yield* Effect.sleep(400);
    yield* Effect.sync(() =>
      log(
        "compensate",
        `refundCharge → ${charge.id} refunded $${charge.amount.toFixed(2)} (saga compensation)`
      )
    );
  });
}

/**
 * Step 2 — charge the card. Slow (~2.6s) so cancellation is clickable.
 * Declines with a *typed* CardDeclinedError when `declineCard` is set —
 * not retried (the `while` predicate only retries transient failures).
 * In-step compensation: interruption mid-charge voids the authorization
 * via a finalizer on the program itself.
 */
export function chargeCard(amount: number, declineCard: boolean) {
  const attempt = Effect.gen(function* () {
    yield* Effect.sleep(2600);
    if (declineCard) return yield* new CardDeclinedError({ amount });
    const charge: Charge = { id: `ch_${++seq}`, amount };
    yield* Effect.sync(() => log("success", `chargeCard → ${charge.id} for $${amount.toFixed(2)}`));
    return charge;
  });

  return Effect.gen(function* () {
    yield* Effect.sync(() => log("start", `chargeCard — authorizing $${amount.toFixed(2)}`));
    return yield* attempt;
  }).pipe(
    Effect.tapError(e =>
      Effect.sync(() => log("error", `chargeCard failed: ${e._tag} ($${e.amount.toFixed(2)})`))
    ),
    Effect.onInterrupt(() =>
      Effect.sync(() => log("compensate", "chargeCard interrupted — voiding card authorization"))
    )
  );
}

/** Step 3 — finalize the order. ~700ms. */
export function createOrder(items: CartItem[], reservation: Reservation, charge: Charge) {
  return Effect.gen(function* () {
    yield* Effect.sync(() =>
      log("start", `createOrder — committing ${reservation.id} + ${charge.id}`)
    );
    yield* Effect.sleep(700);
    const order: Order = {
      id: `ord_${++seq}`,
      items,
      total: charge.amount,
      placedAt: new Date().toLocaleTimeString()
    };
    ORDERS = [order, ...ORDERS];
    yield* Effect.sync(() => log("success", `createOrder → ${order.id} confirmed`));
    return order;
  }).pipe(
    Effect.onInterrupt(() =>
      Effect.sync(() => log("interrupt", "createOrder interrupted before commit"))
    )
  );
}
