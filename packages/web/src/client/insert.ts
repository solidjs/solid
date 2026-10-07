// @ts-nocheck
// The children runtime: `insert` (a hole's reactive content), the one-shot
// `insertExpression` / `normalize` pair `assign` writes children through, and
// the hydration-time behaviours of both (claiming a parent's child nodes,
// re-claiming a swapped region, deduping replayed events) behind the
// `hydrationRt` slot `hydrate()` fills. Its own module so the attribute
// runtime (client/attributes.ts) can reach `insertExpression` without those
// internals becoming public exports of client.ts (which the entry re-exports
// wholesale); the public names here are re-exported by index.ts explicitly.
import { getOwner, flatten } from "solid-js";
import { sharedConfig } from "solid-js/internal";
import { $$SLOT, $$HOST } from "../constants.js";
import { effect, spreadName, tagElement } from "../render.js";
import reconcileArrays from "../reconcile.js";
import { devCheck, unscopedHoleAllocatedIds } from "../diagnostics.js";
import { JSX } from "../../jsx/jsx.js";

type MountableElement = Element | Document | ShadowRoot | DocumentFragment | Node;

// The outer insert effect's marker value for "the inner effect owns the
// content" (see insert).
const INNER_OWNED = {};

const SCOPE_OPTIONS = { scope: true };

// Dev CHECK: an unscoped hole built content on the enclosing id counter
// while hydrating, and that content missed its server-rendered keys —
// `UNSCOPED_HOLE_ALLOCATED_IDS` (diagnostics.ts; the server's `ssr()` hole
// loop runs its half). `insert`'s outer effect is transparent unless the
// compiler tagged the accessor (`$s`), so a bare function it was handed
// (`{renderHead}`) builds its content on the enclosing counter at statement
// time, where the server builds it in walk order — after the scoped holes
// that follow it reserved theirs. Allocation alone is not the finding (a
// function hole with nothing scoped after it lands on the same ids both
// sides); the client cannot see the server's template, so it reports the
// permutation it can observe: a key miss (`getNextElement`) inside the
// bracket. The snapshot is taken only while hydrating, for an untagged
// accessor, and outside a runtime children insert: `spread`'s is
// transparent BY DESIGN — the server's `ssrElement` evaluates the same
// children inline in the same position — and marks its element in
// `unscopedByDesign` for the duration of the (synchronous) first compute.
// Once per site: the owner labels, the element, the function name.
let unscopedByDesign = null;
let reportedHoleSites = null;
let hydrationKeyMisses = 0;
function unscopedHoleSnapshot(accessor, parent) {
  if (
    accessor.$s ||
    !sharedConfig.hydrating ||
    parent === unscopedByDesign ||
    sharedConfig.devPeekNextContextId === undefined
  )
    return undefined;
  return { next: sharedConfig.devPeekNextContextId(), misses: hydrationKeyMisses };
}
function checkUnscopedHole(snapshot, accessor, parent) {
  if (snapshot === undefined || hydrationKeyMisses === snapshot.misses) return;
  const after = sharedConfig.devPeekNextContextId();
  if (after === snapshot.next) return;
  let site = parent.nodeName + "|" + accessor.name;
  for (let o = getOwner(); o !== null; o = o._parent) if (o._name) site = o._name + "|" + site;
  if ((reportedHoleSites || (reportedHoleSites = new Set())).has(site)) return;
  reportedHoleSites.add(site);
  unscopedHoleAllocatedIds(snapshot.next, after, accessor.name ? { name: accessor.name } : {});
}

// Hydration-time behaviors reached from the hot insert/event paths, installed
// by hydrate() so client-only bundles shake the implementations. Call sites
// guard on the null slot; only hydrate() can assign it (#2883). Rollup folds
// the guards away entirely in CSR bundles; esbuild keeps the ~30-byte residue
// but drops these bodies once nothing else references them. Exported as a
// live binding for the delegated dispatch in client.ts (`dedupEvent`); the
// slot is only ever assigned here.
export let hydrationRt = null;
export function installHydrationRuntime() {
  hydrationRt = {
    // insert(): claim the parent's childNodes as the initial current on
    // hydration, dropping server text-hole separators.
    claimInitial(parent, multi, initial) {
      if (isHydrating(parent)) {
        if (!multi && initial === undefined && parent) initial = claimChildNodes(parent);
        else if (Array.isArray(initial)) stripTextSeparators(initial);
      }
      return initial;
    },
    // A streamed `$df` fragment swap replaces a hole's region out from under
    // its bookkeeping (Loading fallback claimed during hydration, settled
    // content swapped in later). When the tracked nodes are gone
    // mid-hydration, re-claim the live region so the content pass can match
    // loose text positionally — elements recover through the registry, text
    // only has position. The region is `parent`'s children, or for
    // marker-bounded holes the nodes back to the matching `<!--$-->` start.
    reclaimRegion(current, parent, marker) {
      if (!sharedConfig.hydrating || !current || !parent.isConnected) return current;
      const first = Array.isArray(current) ? current[0] : current;
      if (!first || !first.nodeType || first.isConnected) return current;
      let nodes;
      if (marker) {
        nodes = [];
        let node = marker.previousSibling,
          depth = 0;
        while (node) {
          if (node.nodeType === 8) {
            const v = node.nodeValue;
            if (v === "/") depth++;
            else if (v === "$") {
              if (depth === 0) break;
              depth--;
            }
          }
          nodes.unshift(node);
          node = node.previousSibling;
        }
      } else return claimChildNodes(parent);
      return stripTextSeparators(nodes);
    },
    // eventHandler(): replayed server events are deduped against the live
    // event queue during hydration.
    dedupEvent(e) {
      return !!(
        sharedConfig.registry &&
        sharedConfig.events &&
        sharedConfig.events.find(([el, ev]) => ev === e)
      );
    }
  };
}

// Drop the `<!--!$-->` text-hole separators the server emits so adjacent
// text nodes stay individually claimable; the array is compacted in place.
// A pending boundary's placeholder scaffolding — `<template id="pl-X">` and
// its `<!--pl-X-->` end marker — is excluded from the claim array but KEPT in
// the DOM (the $df swap still needs it). While the boundary is pending its
// fallback hydrates into the region between the two; counting the scaffolding
// shifted every positional text claim, so the fallback's reactive text never
// adopted the server node and updates appended beside it as permanent debris
// (solidjs/solid#2936).
function stripTextSeparators(nodes) {
  let j = 0;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i],
      t = node.nodeType;
    if (t === 8 && node.nodeValue === "!$") {
      node.remove();
      continue;
    }
    if (isPlaceholderScaffolding(node, t)) continue;
    nodes[j++] = node;
  }
  nodes.length = j;
  return nodes;
}

// The claim array for a parent's children: one indexed pass over the live
// childNodes with the separators dropped as it copies. This runs for every
// insert() during hydration, so it avoids `[...parent.childNodes]` (the
// iterator protocol over a live NodeList) followed by a second compacting
// pass. Removing a `<!--!$-->` shifts the live list, so the index holds.
function claimChildNodes(parent) {
  const live = parent.childNodes;
  const out = [];
  for (let i = 0, n = live.length; i < n; i++) {
    const node = live[i],
      t = node.nodeType;
    if (t === 8 && node.nodeValue === "!$") {
      node.remove();
      i--;
      n--;
      continue;
    }
    if (isPlaceholderScaffolding(node, t)) continue;
    out.push(node);
  }
  return out;
}

// A pending boundary's placeholder scaffolding — `<template id="pl-X">` and
// its `<!--pl-X-->` end marker — is excluded from claim arrays but kept in
// the DOM (see stripTextSeparators).
function isPlaceholderScaffolding(node, t) {
  return t === 8
    ? node.nodeValue.startsWith("pl-")
    : t === 1 && node.localName === "template" && node.id.startsWith("pl-");
}

/**
 * Compiler-emitted primitive; not for hand-written code.
 * @internal
 */
export function insert<T>(
  parent: MountableElement,
  accessor: (() => T) | T,
  marker?: Node | null,
  init?: JSX.Element,
  options?: {
    /**
     * Live accessor for the slot's logical host in the source tree (portals).
     * Each top-level node the slot manages is tagged with a `_$host` getter
     * backed by this accessor so delegated events retarget correctly.
     */
    host?: () => Node | null;
    /** Defer the insert effect to the queue instead of running it inline. */
    schedule?: boolean;
    /**
     * Label for the hole's render effects (the outer and, for a nested
     * accessor, the inner unwrapping effect) — the compiler emits the parent
     * tag as written under `sourceNames.bindings` (`div.children`). Dev and
     * observe runtimes carry it on the node; production ignores it.
     */
    name?: string;
  }
): JSX.Element;

export function insert(parent, accessor, marker, initial, options) {
  // Inside a labelled `spread` (see there): the children insert is
  // `<tag>.children`, taken before `effect` would label it `<tag>.spread`.
  if (
    "_SOLID_OBSERVE_" &&
    spreadName !== undefined &&
    (options === undefined || options.name === undefined)
  )
    options = { ...options, name: spreadName + ".children" };
  const multi = marker !== undefined;
  const host = options && options.host;
  if (multi && !initial) initial = [];
  if (hydrationRt !== null) initial = hydrationRt.claimInitial(parent, multi, initial);
  if (typeof accessor !== "function") {
    accessor = normalize(accessor, initial, multi, true);
    if (typeof accessor !== "function") {
      insertExpression(parent, accessor, initial, marker);
      host && tagHost(accessor, host);
      return;
    }
  }
  if (multi && initial.length === 0) {
    const placeholder = document.createTextNode("");
    parent.insertBefore(placeholder, marker);
    initial = [placeholder];
  }
  let current = initial;
  effect(
    prev => {
      if (hydrationRt !== null) current = hydrationRt.reclaimRegion(current, parent, marker);
      // Dev: bracket an unscoped accessor's evaluation while hydrating — a
      // scoped one owns its ids; this effect is transparent, so anything an
      // unscoped one builds takes ids from the enclosing counter, and a key
      // miss inside the bracket is the permutation. Checked again after the
      // inner effect below, whose synchronous first compute unwraps an
      // accessor that returned a function (one report per site).
      const devNext = "_SOLID_DEV_" ? unscopedHoleSnapshot(accessor, parent) : undefined;
      const value = normalize(accessor(), current, multi, true);
      if ("_SOLID_DEV_") checkUnscopedHole(devNext, accessor, parent);
      if (typeof value !== "function") return value;
      effect(
        () => (
          hydrationRt !== null && (current = hydrationRt.reclaimRegion(current, parent, marker)),
          normalize(value, current, multi)
        ),
        inner => {
          current = insertExpression(parent, inner, current, marker);
          host && tagHost(current, host);
        },
        prev !== undefined && !(options && options.schedule)
          ? { ...options, schedule: true }
          : options
      );
      if ("_SOLID_DEV_") checkUnscopedHole(devNext, accessor, parent);
      return INNER_OWNED;
    },
    value => {
      if (value === INNER_OWNED) return;
      current = insertExpression(parent, value, current, marker);
      host && tagHost(current, host);
    },
    // Only the OUTER effect takes the scope — the inner unwrapping effect
    // stays transparent so content ids keep a fixed depth per hole.
    accessor.$s ? (options ? { ...options, scope: true } : SCOPE_OPTIONS) : options
  );
}

/** Dev: `spread`'s children insert is unscoped by design (see unscopedHoleSnapshot). */
export function setUnscopedByDesign(node) {
  unscopedByDesign = node;
}

/** Dev: `getNextElement` reports a hydration key miss (see checkUnscopedHole). */
export function noteHydrationKeyMiss() {
  hydrationKeyMisses++;
}

// Whether `node` is being CLAIMED by the running hydration pass (and not
// freshly created beside it). Shared by the attribute writers, the template
// and hydration-walk helpers in client.ts, and the inserts here.
export function isHydrating(node) {
  if (!sharedConfig.hydrating) return false;
  // A streamed boundary's resume window claims only the subtree under that
  // boundary; the rest of the page hydrated in the root pass. A render the
  // window forces outside it — the resumed content's onSettled writing a
  // signal above the boundary, revealing a <Show> there (#3504) — is a
  // client render: fresh nodes, live inserts, no registry lookup.
  if (sharedConfig.isClaiming && !sharedConfig.isClaiming()) return false;
  if (!node || node.isConnected) return true;
  // Connectivity tells claimed SSR nodes apart from fresh template clones,
  // but a claimed tree isn't always IN the document: a frame adoption whose
  // slot fill resolved async claims its server-rendered range after a
  // pending boundary displaced it (re-inserted on reveal). Such claim scopes
  // declare their roots (sharedConfig.claimRoots); descent from one is as
  // claimed as being connected. Fresh clones descend from neither.
  const roots = sharedConfig.claimRoots;
  if (roots) {
    for (let i = 0; i < roots.length; i++) {
      if (roots[i].contains(node)) return true;
    }
  }
  return false;
}

// The one-shot write of a resolved value into `parent`'s region (`current` →
// `value`, before `marker`): `insert`'s commit half, and what `assign`
// (client/attributes.ts) writes a props `children` through without an effect.
export function insertExpression(parent, value, current, marker) {
  if ("_SOLID_DEV_") tagElement(parent);
  if (hydrationRt !== null && isHydrating(parent)) {
    // A hydrating render is a claim pass, not a mutation pass — but the
    // caller's `current` bookkeeping must stay HONEST about what the DOM
    // holds. A render whose nodes never entered the DOM (a boundary's
    // client fallback while the range shows the server's settled content —
    // the adopted-fill shape: markup settled server-side, the slot arg
    // settles locally a beat later) must not displace the tracked range:
    // the next real insert would reconcile against nodes that were never
    // there and leave the server's beside the new content as permanent
    // residue. Claimed nodes are connected (or under a declared claim
    // root); phantom renders are neither, and keep `current` as-is.
    if (value && value !== current) {
      const arr = Array.isArray(value);
      for (const n of arr ? value : [value]) {
        if (n && n.nodeType) {
          if (!isHydrating(n)) return current;
        } else if (arr && (typeof n === "string" || typeof n === "number")) {
          // A raw primitive in an ARRAY during a claim pass is a text hole
          // whose claim failed (normalize adopts live text nodes while
          // hydrating). Materializing it would mutate DOM mid-claim, and
          // returning it would put a primitive into node bookkeeping — same
          // treatment as the phantom-node case above, which is exactly what
          // the fresh detached node this path used to allocate triggered.
          return current;
        }
      }
    }
    return value;
  }
  if (value === current) return value;
  // A region tracked as empty can receive nodes that already sit in it:
  // server nodes a boundary claims on a late resume, after this insert's
  // claim pass saw no value (#3749). Re-inserting them would move connected
  // nodes and blur a focused input, so they stay put. Only while hydrating
  // (the resume window sets the flag): then claimed server nodes are the only
  // nodes of ours already in `parent`, and they arrive in server order. Every
  // item must be a node in `parent` (a raw primitive is a failed text claim
  // and still needs inserting); an empty array keeps its clear.
  if (
    hydrationRt !== null &&
    sharedConfig.hydrating &&
    current == null &&
    value &&
    [].concat(value).every(n => n?.parentNode === parent) &&
    value.length !== 0
  )
    return value;
  const t = typeof value,
    multi = marker !== undefined;

  if (t === "string" || t === "number") {
    const tc = typeof current;
    if (tc === "string" || tc === "number") {
      parent.firstChild.data = value;
    } else {
      if (ownsAllChildren(parent, current)) parent.textContent = value;
      else {
        // Foreign nodes present (e.g. stream-injected stylesheet links) —
        // replace only our own nodes, keeping text content leading.
        removeOwnedChildren(parent, current);
        parent.insertBefore(document.createTextNode(value), parent.firstChild);
      }
    }
  } else if (value === undefined) {
    cleanChildren(parent, current, marker);
  } else if (value.nodeType) {
    if (Array.isArray(current)) {
      cleanChildren(parent, current, multi ? marker : null, value);
    } else if (current != null && current.nodeType) {
      // `current` is a node we previously inserted but it may have been
      // moved out by user code (e.g. ref-driven migration, JSX wrapping)
      // since the last render. If it's still here, replace it in place;
      // otherwise append — never `replaceChild` a node that isn't ours.
      current.parentNode === parent
        ? parent.replaceChild(value, current)
        : parent.appendChild(value);
    } else if (current != null && parent.firstChild) {
      // A sole text child is the raw primitive, and `0` / `NaN` are falsy.
      // Truthiness would skip this replace and leave that text node beside
      // the new element (#3571).
      parent.replaceChild(value, parent.firstChild);
    } else {
      parent.appendChild(value);
    }
    if (marker) value[$$SLOT] = marker;
  } else if (Array.isArray(value)) {
    const currentArray = Array.isArray(current);
    // Commit-time text materialization (normalize left primitives raw): a
    // primitive slot adopts the positional text node with a `.data` write
    // when one is there, and allocates only otherwise. The adopted node's
    // identity makes the reconcile below a no-op for that slot — the common
    // "dynamic text beside an element" update becomes one data write instead
    // of a node allocation plus a swap.
    for (let i = 0, len = value.length; i < len; i++) {
      const item = value[i],
        t = typeof item;
      if (t === "string" || t === "number") {
        const prev = currentArray ? current[i] : undefined;
        if (prev && prev.nodeType === 3) {
          if (prev.data !== "" + item) prev.data = item;
          value[i] = prev;
        } else value[i] = document.createTextNode(item);
      }
    }
    if (value.length === 0) {
      cleanChildren(parent, current, marker);
    } else if (currentArray) {
      if (current.length === 0) {
        appendNodes(parent, value, marker);
      } else reconcileArrays(parent, current, value, marker);
    } else {
      // Same sole-primitive case: `0` / `NaN` still own a text node (#3571).
      if (current != null) cleanChildren(parent, current);
      appendNodes(parent, value);
    }
  } else if ("_SOLID_DEV_")
    // The server renderer's code for the same rule (`UNRECOGNIZED_INSERT_VALUE`
    // in server.ts); the finding locates to the owner whose binding inserted.
    devCheck({
      code: "UNRECOGNIZED_INSERT_VALUE",
      kind: "render",
      severity: "warn",
      message: `[UNRECOGNIZED_INSERT_VALUE] Unrecognized value. Skipped inserting (${typeof value}).`,
      data: { type: typeof value, value }
    });
  return value;
}

export function normalize(value, current, multi, doNotUnwrap) {
  value = flatten(value, { skipNonRendered: true, doNotUnwrap });
  if (doNotUnwrap && typeof value === "function") return value;
  if (multi && !Array.isArray(value)) value = [value != null ? value : ""];
  // Primitives pass through RAW: normalize runs in the compute phase, where
  // a transition fork must not touch the live DOM (and must not pay a text
  // node allocation per changed value only for reconcile to swap it in).
  // insertExpression materializes them at commit, adopting the positional
  // text node with a `.data` write when one is there. The exception is
  // hydration claiming: adopting the already-live server text node here is
  // position bookkeeping, not a mutation, and insertExpression's claim pass
  // needs the node (a raw primitive there means the claim FAILED).
  // Only ACTUAL hydrating nodes (connected or under a declared claim root)
  // adopt: a detached subtree rendering while hydration is globally active —
  // eager JSX whose template claim missed because a falsy server conditional
  // never rendered it (#3163) — is a client render, and adopting its empty
  // placeholder here would swallow the primitive so the initial fill never
  // lands.
  if (sharedConfig.hydrating && Array.isArray(value)) {
    for (let i = 0, len = value.length; i < len; i++) {
      const item = value[i],
        prev = current && current[i],
        t = typeof item;
      if ((t === "string" || t === "number") && prev && prev.nodeType === 3 && isHydrating(prev))
        value[i] = prev;
    }
  }
  return value;
}

// Applied after each `insert` update when the `host` option is present (e.g.
// portals): the slot's top-level nodes get a live `_$host` getter so event
// retargeting can route back to the slot's logical position in the source
// tree. Tagging here — rather than intercepting individual DOM calls — covers
// every insertion path (append, replaceChild, reconcile, hydration claim)
// without touching the hot reconcile loops. `$$HOST` short-circuits nodes
// already tagged for this host on subsequent updates.
function tagHost(value, host) {
  if (Array.isArray(value)) {
    for (let i = 0, len = value.length; i < len; i++) tagHost(value[i], host);
  } else if (value && value.nodeType && value[$$HOST] !== host) {
    value[$$HOST] = host;
    Object.defineProperty(value, "_$host", { get: host, configurable: true });
  }
}

function appendNodes(parent, array, marker = null) {
  for (let i = 0, len = array.length; i < len; i++) {
    const n = array[i];
    parent.insertBefore(n, marker);
    if (marker) n[$$SLOT] = marker;
  }
}

// Whether the tracked `current` value accounts for all of the parent's
// children, using only O(1) boundary pointer reads — `childNodes.length`
// re-counts the child list after every mutation, which is O(n) on exactly
// the hot markerless clear path this guards. Foreign nodes appended after
// our content (late-flushed stylesheet <link>s at the end of <body>) break
// the `lastChild` identity. `current == null` (initial render / untracked
// content) reports true, preserving the designed clear-on-first-render
// behavior.
function ownsAllChildren(parent, current) {
  if (current == null) return true;
  if (Array.isArray(current)) {
    return current.length
      ? parent.firstChild === current[0] && parent.lastChild === current[current.length - 1]
      : parent.firstChild === null;
  }
  if (current === "") return parent.firstChild === null; // `textContent = ""` left no node behind
  if (current.nodeType) return parent.firstChild === current && parent.lastChild === current;
  // string/number content lives in a single leading text node
  const first = parent.firstChild;
  return first !== null && first.nodeType === 3 && parent.lastChild === first;
}

// Remove only the nodes tracked by `current` from a root-level (markerless)
// region, leaving foreign siblings in place.
function removeOwnedChildren(parent, current) {
  if (Array.isArray(current)) {
    for (let i = 0; i < current.length; i++) {
      const el = current[i];
      if (el.parentNode === parent) el.remove();
    }
  } else if (current.nodeType) {
    if (current.parentNode === parent) current.remove();
  } else {
    // string/number content lives in a leading text node (set via
    // `textContent = value`, before any foreign node was appended).
    const first = parent.firstChild;
    if (first && first.nodeType === 3) first.remove();
  }
}

function cleanChildren(parent, current, marker, replacement) {
  if (marker === undefined) {
    // Root-level clear (no marker). `textContent = ""` wipes every child,
    // which is only safe when the nodes we track are the parent's only
    // children. Streaming can append foreign nodes to the root (late-flushed
    // stylesheet <link>s land at the end of <body>) and those must survive a
    // re-render — wiping them drops loaded CSS.
    if (ownsAllChildren(parent, current)) return (parent.textContent = "");
    return removeOwnedChildren(parent, current);
  }
  if (current.length) {
    let inserted = false;
    for (let i = current.length - 1; i >= 0; i--) {
      const el = current[i];
      if (replacement !== el) {
        const tag = el[$$SLOT];
        const owns = el.parentNode === parent && (!tag || tag === marker);
        if (replacement && !inserted && !i)
          owns ? parent.replaceChild(replacement, el) : parent.insertBefore(replacement, marker);
        else if (owns) el.remove();
      } else inserted = true;
    }
  } else if (replacement) parent.insertBefore(replacement, marker);
  if (replacement && marker) replacement[$$SLOT] = marker;
}
