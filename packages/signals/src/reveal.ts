/**
 * Reveal order — `createRevealOrder` (`<Reveal>`): the order in which a group
 * of Loading boundaries (its direct slots) may show their content.
 *
 * A controller owns each slot until the slot has shown content, and forces
 * on the slots it owns the state the order dictates: gated (the fallback,
 * whatever the content's state) and, in a collapsed sequential tail, nothing
 * at all. A nested reveal order is a composite slot of its parent — gated,
 * it gates all of its own; released, it runs its own order.
 *
 * - `sequential`: slots reveal front to back. The first unready slot is the
 *   frontier — its fallback shows; the slots behind it are gated (collapsed
 *   when `collapsed`); the ones before it have revealed.
 * - `together`: every owned slot is gated until all are minimally ready;
 *   then all are released at once.
 * - `natural`: each slot reveals on its own as it becomes ready.
 *
 * A slot graduates when it shows content: a later re-arm of it gates nobody
 * else, and slots appended after graduation form a fresh frontier. The
 * boundary tells the controller when its readiness changed (boundaries.ts:
 * caught, settled, shown, disposed); `order`/`collapsed` are tracked by a
 * computed of the group's own.
 */
import { computed, runWithOwner, untrack } from "./core/core.js";
import { cleanup, createOwner } from "./core/owner.js";
import { ready, redraw, REVEAL, setRevealHooks, type Boundary } from "./boundaries.js";

export type RevealOrder = "sequential" | "together" | "natural";
type OrderAccessor = () => RevealOrder;
type BoolAccessor = () => boolean;
type Slot = Boundary | RevealController;

const FALSE_ACCESSOR: BoolAccessor = () => false;
const SEQUENTIAL_ACCESSOR: OrderAccessor = () => "sequential";

const isController = (slot: Slot): slot is RevealController => slot instanceof RevealController;

const slotReady = (slot: Slot): boolean => (isController(slot) ? slot._isReady() : ready(slot));
const slotMinReady = (slot: Slot): boolean =>
  isController(slot) ? slot._isMinReady() : ready(slot);

/** Force a slot's state. A boundary re-derives its output when it changes;
 * a nested controller passes the state on to its own slots. Released
 * (`!gated`), a nested controller leaves its parent's ownership and runs its
 * own order; a boundary leaves when it has shown content (boundaries.ts). */
function setSlotState(
  slot: Slot,
  controller: RevealController,
  gated: boolean,
  collapsed: boolean
): void {
  if (isController(slot)) {
    slot._gated = gated;
    slot._collapsed = collapsed;
    slot._evaluate();
    // Released and ready — every slot of its own has shown — it graduates,
    // as a boundary does when it shows content. Released at the frontier
    // but not ready, it stays the parent's frontier.
    if (!gated && slot._ready && slot._parent === controller) slot._parent = null;
    return;
  }
  if (slot._gated !== gated || slot._collapsed !== collapsed) {
    slot._gated = gated;
    slot._collapsed = collapsed;
    redraw(slot);
  }
}

class RevealController {
  _slots: Slot[] = [];
  /** The controller gating this one, until it releases this one. */
  _parent: RevealController | null = null;
  /** The state a parent forces on this whole group. */
  _gated = false;
  _collapsed = false;
  _ready = true;
  _minReady = true;
  _evaluating = false;
  constructor(
    public _order: OrderAccessor,
    public _collapse: BoolAccessor
  ) {}
  /** A slot that has left this controller's ownership: a boundary that has
   * shown content, a nested group that is ready. Shown is shown — it counts
   * as ready whatever happens to it later (a re-arm gates nobody else). */
  _done(slot: Slot): boolean {
    return (isController(slot) ? slot._parent : slot._reveal) !== this;
  }
  /** The slots this controller still owns, in registration order — the
   * ones the order's state is forced on. */
  _owned(fn: (slot: Slot) => boolean | void): boolean {
    for (let i = 0; i < this._slots.length; i++) {
      const slot = this._slots[i];
      if (!this._done(slot) && fn(slot) === false) return false;
    }
    return true;
  }
  /** Readiness is judged over every slot, done ones as ready. */
  _isReady(): boolean {
    for (let i = 0; i < this._slots.length; i++) {
      const slot = this._slots[i];
      if (!this._done(slot) && !slotReady(slot)) return false;
    }
    return true;
  }
  /** Something visible to show under its own order — what an enclosing
   * `together` waits for: `together` — every slot minimally ready;
   * `sequential` — the first slot; `natural` — any. */
  _isMinReady(): boolean {
    const order = untrack(this._order);
    const slots = this._slots;
    if (slots.length === 0) return true;
    if (order === "sequential") return this._done(slots[0]) || slotMinReady(slots[0]);
    for (let i = 0; i < slots.length; i++) {
      const min = this._done(slots[i]) || slotMinReady(slots[i]);
      if (order === "natural" ? min : !min) return order === "natural";
    }
    return order !== "natural";
  }
  _register(slot: Slot): void {
    if (this._slots.includes(slot)) return;
    this._slots.push(slot);
    // Gated from the start (collapsed in a collapsed sequential tail); the
    // evaluation releases what the order allows.
    const collapsed = untrack(this._order) === "sequential" && !!untrack(this._collapse);
    if (isController(slot)) {
      slot._parent = this;
      slot._gated = true;
      slot._collapsed = collapsed;
      slot._evaluate();
    } else {
      slot._reveal = this;
      slot._gated = true;
      slot._collapsed = collapsed;
    }
    untrack(() => this._evaluate());
  }
  _unregister(slot: Slot): void {
    const index = this._slots.indexOf(slot);
    if (index >= 0) this._slots.splice(index, 1);
    untrack(() => this._evaluate());
  }
  /** Apply the order to the owned slots — or, gated by a parent, its state
   * to all of them. */
  _evaluate(): void {
    if (this._evaluating) return;
    this._evaluating = true;
    const wasReady = this._ready;
    const wasMinReady = this._minReady;
    try {
      const order = untrack(this._order);
      const collapseTail = order === "sequential" && !!untrack(this._collapse);
      if (this._gated) {
        this._owned(slot => setSlotState(slot, this, true, this._collapsed));
      } else if (order === "natural") {
        this._owned(slot => {
          if (isController(slot)) setSlotState(slot, this, false, false);
          else setSlotState(slot, this, !ready(slot), false);
        });
      } else if (order === "together") {
        const minReady = this._owned(slotMinReady);
        this._owned(slot => setSlotState(slot, this, !minReady, false));
      } else {
        let pendingSeen = false;
        this._owned(slot => {
          if (pendingSeen) return setSlotState(slot, this, true, collapseTail);
          if (slotReady(slot)) return setSlotState(slot, this, false, false);
          pendingSeen = true;
          // The frontier: its fallback shows; a nested controller at the
          // frontier runs its own order.
          setSlotState(slot, this, isController(slot) ? false : true, false);
        });
      }
    } finally {
      this._ready = this._isReady();
      this._minReady = this._isMinReady();
      this._evaluating = false;
    }
    if (this._parent !== null && (wasReady !== this._ready || wasMinReady !== this._minReady))
      this._parent._evaluate();
  }
}

/**
 * Lower-level primitive behind `<Reveal>`: coordinates the order in which the
 * Loading boundaries created directly inside `fn` reveal their content.
 *
 * @param fn the subtree; the Loading boundaries it creates directly are the
 *   group's slots, a nested `createRevealOrder` a composite slot
 * @param options `order` — `"sequential"` (default: front to back, the
 *   first unready slot showing its fallback), `"together"` (all at once),
 *   `"natural"` (each on its own); `collapsed` — in a sequential group, the
 *   slots behind the frontier render nothing instead of their fallbacks
 */
export function createRevealOrder<T>(
  fn: () => T,
  options?: { order?: OrderAccessor; collapsed?: BoolAccessor }
): T {
  const owner = createOwner();
  const parent = owner._context[REVEAL] as RevealController | null | undefined;
  const controller = new RevealController(
    options?.order || SEQUENTIAL_ACCESSOR,
    options?.collapsed || FALSE_ACCESSOR
  );
  owner._context = { ...owner._context, [REVEAL]: controller };
  return runWithOwner(owner, () => {
    const value = fn();
    const evaluate = computed(() => {
      controller._order();
      controller._collapse();
      controller._evaluate();
    });
    if (__OBSERVE__) (evaluate as any)._name = "reveal order";
    if (parent) {
      parent._register(controller);
      cleanup(() => parent._unregister(controller));
    }
    return value;
  });
}

// Installed at module evaluation — present exactly when something imports
// `createRevealOrder`; a Loading boundary without one pays a null check.
setRevealHooks({
  _register: (controller, b) => (controller as RevealController)._register(b),
  _unregister: (controller, b) => (controller as RevealController)._unregister(b),
  _changed: controller => (controller as RevealController)._evaluate()
});
