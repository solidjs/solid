/**
 * @jsxImportSource @solidjs/web
 *
 * Unified For — HYDRATION scenarios (H2 v1). Rendered by the server harness
 * (test/server/hydration-harness.spec.tsx → __artifacts__) and hydrated by
 * test/hydration/for-slot.spec.tsx, which asserts slot-specific invariants
 * on top of the generic parity ones:
 *
 *   - whole-parent keyed lists ENGAGE during hydration (engaged counter)
 *   - rows are the SERVER nodes (identity), no key-miss warnings
 *   - the first post-hydration STRUCTURAL update runs through the slot
 *   - server/client MISMATCH reconciles at the fill commit (both directions)
 *   - a demote DURING the hydrating fill hands claims back — classic's
 *     re-run claims the same nodes (the "never strand a claim" invariant)
 *   - anchored holes (null/element markers) stay classic under hydration
 *
 * Mismatch scenarios diverge on `isServer` so one source renders both sides.
 */
import { createSignal, For, Show } from "solid-js";
import { isServer } from "@solidjs/web";

export type ForSlotScenario = {
  name: string;
  App: () => any;
  /** container.textContent after hydration settles */
  expectedText: string;
  /** server-visible text when it legitimately differs (mismatch cases) */
  serverText?: string;
  /** how many slots must ENGAGE during hydrate() (0 = classic expected) */
  engaged: number;
  /** how many slots must DEMOTE during hydrate() */
  demoted: number;
  /** expected console.warn calls during hydrate (key misses on real mismatch) */
  warnings: number;
  /** selector for row nodes that must be the SERVER nodes after hydration */
  identitySelector?: string;
  /** post-hydration update + expectations */
  update?: () => void;
  expectedTextAfterUpdate?: string;
  /** after update: these server nodes (by initial text) must survive as the
   * same node objects (moved, not recreated) */
  survivorsAfterUpdate?: string[];
};

// ---------------------------------------------------------------------------
// 1. Basic whole-parent list; post-hydration REORDER (structural, slot path)
let setBasic!: (v: string[]) => void;
function SlotBasic() {
  const [items, set] = createSignal(["a", "b", "c"]);
  setBasic = set;
  return (
    <ul>
      <For each={items()}>{item => <li>{item}</li>}</For>
    </ul>
  );
}

// ---------------------------------------------------------------------------
// 2. Text rows (no template keys) — fresh text replaces server text at the
//    fill commit; post-hydration append.
let setText!: (v: string[]) => void;
function SlotTextRows() {
  const [items, set] = createSignal(["a", "b", "c"]);
  setText = set;
  return (
    <ul>
      <For each={items()}>{item => item}</For>
    </ul>
  );
}

// ---------------------------------------------------------------------------
// 3. Mismatch: server has MORE rows than the client — leftover removed.
function SlotFewer() {
  const [items] = createSignal(isServer ? ["a", "b", "c"] : ["a", "b"]);
  return (
    <ul>
      <For each={items()}>{item => <li>{item}</li>}</For>
    </ul>
  );
}

// ---------------------------------------------------------------------------
// 4. Mismatch: client has MORE rows than the server — fresh row inserted
//    (one key-miss warning is the expected, honest signal).
function SlotMore() {
  const [items] = createSignal(isServer ? ["a", "b"] : ["a", "b", "c"]);
  return (
    <ul>
      <For each={items()}>{item => <li>{item}</li>}</For>
    </ul>
  );
}

// ---------------------------------------------------------------------------
// 5. Demote DURING the hydrating fill: row "b" renders a <Show> (function
//    top level) after row "a" already CLAIMED. The slot must hand a's claim
//    back so classic's re-run claims the same server node — no warnings,
//    no phantom rows, and the classic path then owns the list.
let setDemote!: (v: string[]) => void;
function SlotDemoteMidFill() {
  const [items, set] = createSignal(["a", "b", "c"]);
  setDemote = set;
  return (
    <ul>
      <For each={items()}>
        {item =>
          item === "b" ? (
            <Show when={true}>
              <li>{item}</li>
            </Show>
          ) : (
            <li>{item}</li>
          )
        }
      </For>
    </ul>
  );
}

// ---------------------------------------------------------------------------
// 6. Empty list on both sides; post-hydration first row.
let setEmpty!: (v: string[]) => void;
function SlotEmpty() {
  const [items, set] = createSignal<string[]>([]);
  setEmpty = set;
  return (
    <ul>
      <For each={items()}>{item => <li>{item}</li>}</For>
    </ul>
  );
}

// ---------------------------------------------------------------------------
// 7. Trailing hole (preceding sibling → null marker): stays CLASSIC under
//    hydration in v1; must hydrate cleanly and update.
let setTrailing!: (v: string[]) => void;
function SlotTrailingClassic() {
  const [items, set] = createSignal(["a", "b"]);
  setTrailing = set;
  return (
    <ul>
      <li>head</li>
      <For each={items()}>{item => <li>{item}</li>}</For>
    </ul>
  );
}

// ---------------------------------------------------------------------------
// 8. Nested whole-parent lists: both engage; nested ids mint in parity.
// Stable group objects: the outer reorder must MOVE rows (identity keys),
// not rebuild them — otherwise the survivor check would be vacuous.
const GX = { g: "x", items: ["1", "2"] };
const GY = { g: "y", items: ["3"] };
let setNested!: (v: { g: string; items: string[] }[]) => void;
function SlotNested() {
  const [groups, set] = createSignal([GX, GY]);
  setNested = set;
  return (
    <ul>
      <For each={groups()}>
        {group => (
          <li>
            <ul>
              <For each={group.items}>{item => <span>{item}</span>}</For>
            </ul>
          </li>
        )}
      </For>
    </ul>
  );
}

// ---------------------------------------------------------------------------
// 9. For passed THROUGH a component's children (the hole seam) — the
//    wrapper's `{props.children}` hole engages under hydration too.
function ListShell(props: { children: any }) {
  return <ul>{props.children}</ul>;
}
let setThrough!: (v: string[]) => void;
function SlotThroughChildren() {
  const [items, set] = createSignal(["a", "b", "c"]);
  setThrough = set;
  return (
    <ListShell>
      <For each={items()}>{item => <li>{item}</li>}</For>
    </ListShell>
  );
}

export const forSlotScenarios: ForSlotScenario[] = [
  {
    name: "slot-hydrate-through-children",
    App: SlotThroughChildren,
    expectedText: "abc",
    engaged: 1,
    demoted: 0,
    warnings: 0,
    identitySelector: "li",
    update: () => setThrough(["b", "c", "a"]),
    expectedTextAfterUpdate: "bca",
    survivorsAfterUpdate: ["a", "b", "c"]
  },
  {
    name: "slot-hydrate-basic",
    App: SlotBasic,
    expectedText: "abc",
    engaged: 1,
    demoted: 0,
    warnings: 0,
    identitySelector: "li",
    update: () => setBasic(["c", "a", "b"]),
    expectedTextAfterUpdate: "cab",
    survivorsAfterUpdate: ["a", "b", "c"]
  },
  {
    name: "slot-hydrate-text-rows",
    App: SlotTextRows,
    expectedText: "abc",
    engaged: 1,
    demoted: 0,
    warnings: 0,
    update: () => setText(["a", "b", "c", "d"]),
    expectedTextAfterUpdate: "abcd"
  },
  {
    name: "slot-hydrate-mismatch-fewer",
    App: SlotFewer,
    expectedText: "ab",
    serverText: "abc",
    engaged: 1,
    demoted: 0,
    warnings: 0,
    identitySelector: "li"
  },
  {
    name: "slot-hydrate-mismatch-more",
    App: SlotMore,
    expectedText: "abc",
    serverText: "ab",
    engaged: 1,
    demoted: 0,
    warnings: 1
  },
  {
    name: "slot-hydrate-demote-mid-fill",
    App: SlotDemoteMidFill,
    expectedText: "abc",
    engaged: 1,
    demoted: 1,
    warnings: 0,
    identitySelector: "li",
    update: () => setDemote(["a", "b", "c", "d"]),
    expectedTextAfterUpdate: "abcd"
  },
  {
    name: "slot-hydrate-empty",
    App: SlotEmpty,
    expectedText: "",
    engaged: 1,
    demoted: 0,
    warnings: 0,
    update: () => setEmpty(["a"]),
    expectedTextAfterUpdate: "a"
  },
  {
    name: "slot-hydrate-trailing-classic",
    App: SlotTrailingClassic,
    expectedText: "headab",
    engaged: 0,
    demoted: 0,
    warnings: 0,
    identitySelector: "li",
    update: () => setTrailing(["b", "a"]),
    expectedTextAfterUpdate: "headba"
  },
  {
    name: "slot-hydrate-nested",
    App: SlotNested,
    expectedText: "123",
    engaged: 3,
    demoted: 0,
    warnings: 0,
    identitySelector: "span",
    update: () => setNested([GY, GX]),
    expectedTextAfterUpdate: "312",
    survivorsAfterUpdate: ["1", "2", "3"]
  }
];
