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
import { createSignal, flush, For, Show } from "solid-js";
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
  /** selector for a parent whose TEXT child nodes must be the server's text
   * nodes after hydration (primitive rows adopt, never replace) */
  textIdentityParent?: string;
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
// 5. DYNAMIC row under hydration: row "b" renders a <Show> (function top
//    level). The slot resolves it tracked in its own compute during the
//    fill — the Show's template claims its server node like any other row;
//    no demote, no warnings, and the slot keeps owning the list.
let setDemote!: (v: string[]) => void;
function SlotDynamicRow() {
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
// 7. Trailing hole (preceding sibling): the hydrating client resolves it to
//    the `<!--/-->` end marker with the bounded region — ENGAGES.
let setTrailing!: (v: string[]) => void;
function SlotTrailing() {
  const [items, set] = createSignal(["a", "b"]);
  setTrailing = set;
  return (
    <ul>
      <li>head</li>
      <For each={items()}>{item => <li>{item}</li>}</For>
    </ul>
  );
}

// 7b. Bounded hole (siblings both sides) — engages; siblings untouched.
let setBounded!: (v: string[]) => void;
function SlotBounded() {
  const [items, set] = createSignal(["a", "b", "c"]);
  setBounded = set;
  return (
    <ul>
      <li>head</li>
      <For each={items()}>{item => <li>{item}</li>}</For>
      <li>tail</li>
    </ul>
  );
}

// 7c. Anchored-hole MISMATCH: server has more rows — leftover removed from
//     the hole only; the sibling and the hole's comment markers survive.
function SlotTrailingFewer() {
  const [items] = createSignal(isServer ? ["a", "b", "c"] : ["a", "b"]);
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

// ---------------------------------------------------------------------------
// 10. NESTED lists + a <Show>-rooted outer row: the outer engages, row x's
//     nested list engages and commits, row y is dynamic (resolved by the
//     outer slot's compute, its nested list engaging inside that resolve).
//     Three slots, zero demotes, every node the server's.
const NX = { g: "x", items: ["1", "2"], special: false };
const NY = { g: "y", items: ["3"], special: true };
function SlotNestedDynamic() {
  const [groups] = createSignal([NX, NY]);
  const inner = (g: typeof NX) => (
    <ul>
      <For each={g.items}>{item => <span>{item}</span>}</For>
    </ul>
  );
  return (
    <ul>
      <For each={groups()}>
        {group =>
          group.special ? (
            <Show when={true}>
              <li>{inner(group)}</li>
            </Show>
          ) : (
            <li>{inner(group)}</li>
          )
        }
      </For>
    </ul>
  );
}

// ---------------------------------------------------------------------------
// 11. Through-children + a dynamic row + server MISMATCH: the slot stays
//     engaged (the <Show>-rooted row resolves in the fill), rows a/b are the
//     server nodes, and the leftover server row `c` is REMOVED by the fill
//     commit's repair, reported once (the slot repairs what classic would
//     leave in place and report at hydration end).
function SlotThroughDynamicMismatch() {
  const [items] = createSignal(isServer ? ["a", "b", "c"] : ["a", "b"]);
  return (
    <ListShell>
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
    </ListShell>
  );
}

// ---------------------------------------------------------------------------
// 12. Through-children + a dynamic row + LATER children change: rows the
//     engaged slot appends live in the hole; swapping the children out
//     afterwards must leave no list residue ("noned" was the classic-path
//     leak this scenario originally caught).
function ShellWrap(props: { children: any }) {
  return <div>{props.children}</div>;
}
let residueItems!: (v: string[]) => void;
let residueShow!: (v: boolean) => void;
function SlotThroughDynamicResidue() {
  const [items, setItems] = createSignal(["a", "b", "c"]);
  const [show, setShow] = createSignal(true);
  residueItems = setItems;
  residueShow = setShow;
  return (
    <ShellWrap>
      {show() ? (
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
      ) : (
        <p>none</p>
      )}
    </ShellWrap>
  );
}

// ---------------------------------------------------------------------------
// 13. TEXT-row mismatch, both directions: server text nodes must never
//     survive beside their fresh twins (no orphan, no duplicate) — the fill
//     removes every region node that isn't ours before inserting.
function SlotTextFewer() {
  const [items] = createSignal(isServer ? ["a", "b", "c"] : ["a", "b"]);
  return (
    <ul>
      <For each={items()}>{item => item}</For>
    </ul>
  );
}
function SlotTextMore() {
  const [items] = createSignal(isServer ? ["a", "b"] : ["a", "b", "c"]);
  return (
    <ul>
      <For each={items()}>{item => item}</For>
    </ul>
  );
}
// Anchored text rows (comment-bounded region with separators) — mismatch.
function SlotTextAnchoredFewer() {
  const [items] = createSignal(isServer ? ["a", "b", "c"] : ["a", "b"]);
  return (
    <ul>
      <li>head</li>
      <For each={items()}>{item => item}</For>
      <li>tail</li>
    </ul>
  );
}

export const forSlotScenarios: ForSlotScenario[] = [
  {
    name: "slot-hydrate-text-mismatch-fewer",
    App: SlotTextFewer,
    expectedText: "ab",
    serverText: "abc",
    engaged: 1,
    demoted: 0,
    warnings: 1 // the slot's repair report (leftover server text row removed)
  },
  {
    name: "slot-hydrate-text-mismatch-more",
    App: SlotTextMore,
    expectedText: "abc",
    serverText: "ab",
    engaged: 1,
    demoted: 0,
    warnings: 1 // the slot's repair report (client text row inserted)
  },
  {
    name: "slot-hydrate-text-anchored-mismatch-fewer",
    App: SlotTextAnchoredFewer,
    expectedText: "headabtail",
    serverText: "headabctail",
    engaged: 1,
    demoted: 0,
    warnings: 1, // the slot's repair report
    identitySelector: "li"
  },
  {
    name: "slot-hydrate-through-dynamic-residue",
    App: SlotThroughDynamicResidue,
    expectedText: "abc",
    engaged: 1,
    demoted: 0,
    warnings: 0,
    identitySelector: "li",
    update: () => {
      residueItems(["a", "b", "c", "d"]); // the engaged slot appends d
      flush();
      residueShow(false); // children change: the hole cleanup must remove d too
    },
    expectedTextAfterUpdate: "none"
  },
  {
    name: "slot-hydrate-nested-dynamic",
    App: SlotNestedDynamic,
    expectedText: "123",
    // Outer + nested x + nested y (engaging inside the outer's resolve of
    // the Show-rooted row). No demote, so no second pass.
    engaged: 3,
    demoted: 0,
    warnings: 0,
    identitySelector: "span"
  },
  {
    name: "slot-hydrate-through-dynamic-mismatch",
    App: SlotThroughDynamicMismatch,
    expectedText: "ab", // the slot's fill commit repairs the leftover
    serverText: "abc",
    engaged: 1,
    demoted: 0,
    warnings: 1, // the slot's repair report
    identitySelector: "li"
  },
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
    textIdentityParent: "ul",
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
    warnings: 1, // the slot's repair report (leftover server row removed)
    identitySelector: "li"
  },
  {
    name: "slot-hydrate-mismatch-more",
    App: SlotMore,
    expectedText: "abc",
    serverText: "ab",
    engaged: 1,
    demoted: 0,
    warnings: 2 // the runtime's key-miss + the slot's repair report
  },
  {
    name: "slot-hydrate-dynamic-row",
    App: SlotDynamicRow,
    expectedText: "abc",
    engaged: 1,
    demoted: 0,
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
    name: "slot-hydrate-trailing",
    App: SlotTrailing,
    expectedText: "headab",
    engaged: 1,
    demoted: 0,
    warnings: 0,
    identitySelector: "li",
    update: () => setTrailing(["b", "a"]),
    expectedTextAfterUpdate: "headba",
    survivorsAfterUpdate: ["head", "a", "b"]
  },
  {
    name: "slot-hydrate-bounded",
    App: SlotBounded,
    expectedText: "headabctail",
    engaged: 1,
    demoted: 0,
    warnings: 0,
    identitySelector: "li",
    update: () => setBounded(["c", "b", "a"]),
    expectedTextAfterUpdate: "headcbatail",
    survivorsAfterUpdate: ["head", "a", "b", "c", "tail"]
  },
  {
    name: "slot-hydrate-trailing-mismatch-fewer",
    App: SlotTrailingFewer,
    expectedText: "headab",
    serverText: "headabc",
    engaged: 1,
    demoted: 0,
    warnings: 1, // the slot's repair report
    identitySelector: "li"
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
