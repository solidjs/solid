// @ts-nocheck
/**
 * The frames range morph, as the wire tier (wire-tier.ts) bundles it: the
 * eager client's records land through it only once content lands over
 * content. Untyped like the eager client (frame-client.ts) it was split from.
 * @internal
 */
import {
  afterRange,
  claimedAttr,
  isFrameElement,
  preservesOpen,
  slotEnd,
  slotStartId,
  CLAIMED_ELEMENTS,
  SLOT_END,
  SLOT_START
} from "./frame-client.js";

// --- Morph -----------------------------------------------------------------
//
// A zero-allocation, two-cursor server-owned DOM patch path: text/attribute
// updates, child insertion/removal, and preservation of two protected marker
// kinds — fragment placeholder ranges and slot ranges. It walks the
// live children and the freshly parsed source in lockstep instead of building
// intermediate token/result arrays, so the common "server churn around client
// anchors" case stays competitive with hand-written morphers.
//
// Slot ranges are opaque protected units: their interior is never
// diffed, and a range already in the right position is never touched — which
// is what preserves focus/selection/media inside it. Placeholder templates
// morph as ordinary elements (their fallback lives in .content, which child
// reconciliation never descends into).
//
// It runs only when content lands over content — a frame's new root
// (refetch, navigation, a live response) and a live hole — so it rides this
// chunk, not the eager client: the frame's flush holds a root over content
// until the tier is resident, and a version bump or rebind over shown
// content starts the load at the header. Adoption and first materialize
// never morph.

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const COMMENT_NODE = 8;

/**
 * Morph a frame's content toward a new root: `ranges` is the frame-wide
 * displaced-range index (the eager client's `#applyRoot` builds it), and
 * subtrees the reconcile inserted whole are grafted afterwards.
 * @internal
 */
export function morph(parent, fragment, claim, ranges) {
  const grafts = [];
  reconcileChildren(parent, fragment, null, null, claim, ranges, grafts);
  if (ranges.size) graft(grafts, ranges);
}

/** Land each displaced range a morph pass left in `ranges` where its
 *  occurrence now is under `roots` (see `flushGrafts`). @internal */
export function graft(roots, ranges) {
  for (const root of roots) flushGrafts(root, ranges);
}

/** Whether `node` is any slot marker (start or end). */
function isSlotMarker(node) {
  if (node.nodeType !== COMMENT_NODE) return false;
  const data = node.data;
  return SLOT_START.test(data) || SLOT_END.test(data);
}

// Identity-first at the element level (DR-5's last rung): server markup can
// carry entity identity as `_key` (the `_hk` family — framework-owned marks,
// compiled from `$key` in server JSX), and a keyed element matches ONLY the
// element with the same key — never positionally. With mismatched keys
// incompatible, the reconcile's existing relocation lookahead moves the
// keyed node into place, so live element state the morph deliberately
// preserves (value/checked properties, `open`, focus) follows the ENTITY
// across reorders instead of latching to the position. Sibling-scoped by
// design: an author key is only unique among siblings (the same id can
// appear under two parents in one frame), so wider matching would
// misattribute horizontally — matching client `For` semantics, where a
// cross-parent move is a teardown. Unkeyed elements (both null) keep
// positional matching untouched.
function compatible(a, b) {
  if (a.nodeType !== b.nodeType) return false;
  if (a.nodeType === ELEMENT_NODE)
    return a.nodeName === b.nodeName && a.getAttribute("_key") === b.getAttribute("_key");
  return a.nodeType === TEXT_NODE || a.nodeType === COMMENT_NODE;
}

export function morphAttributes(oldEl, newEl, claim) {
  let reclaim = false;
  let changed = false;
  const keepOpen = preservesOpen(oldEl);
  const oldAttrs = oldEl.attributes;
  for (let i = oldAttrs.length - 1; i >= 0; i--) {
    const name = oldAttrs[i].name;
    if (keepOpen && name === "open") continue;
    if (!newEl.hasAttribute(name)) {
      oldEl.removeAttribute(name);
      changed = true;
      reclaim ||= claimedAttr(name);
    }
  }
  const newAttrs = newEl.attributes;
  for (let i = 0; i < newAttrs.length; i++) {
    const attr = newAttrs[i];
    const name = attr.name;
    if (keepOpen && name === "open") continue;
    if (oldEl.getAttribute(name) !== attr.value) {
      oldEl.setAttribute(name, attr.value);
      changed = true;
      reclaim ||= claimedAttr(name);
    }
  }
  // The morph is the only write path for server-owned elements, and it makes
  // attributes match server output exactly — including STRIPPING state a
  // claim consumer applied (aria-current, data-active). So a claimable
  // element re-claims on ANY attribute change, letting the consumer
  // reassert; `href`/`action` transitions re-claim even when the element no
  // longer matches the selector (removal must fire, mirroring compiled
  // setAttribute). Direct claims, not subtree sweeps.
  if (claim && (reclaim || (changed && oldEl.matches(CLAIMED_ELEMENTS)))) claim(oldEl, true);
}

/** Morph `oldNode` in place to match `newNode` (assumed `compatible`). */
function morphNode(oldNode, newNode, claim, ranges, grafts) {
  if (oldNode.nodeType === ELEMENT_NODE) {
    // Escape hatch (the claim contract's analogue): an element the author
    // marks `data-preserve` keeps its live attributes AND subtree untouched
    // by the morph — for server DOM that a third-party widget has taken over
    // (a rich editor, a chart) or any state the deny-list above can't name.
    // The element stays matched in position; only its interior is frozen.
    if (oldNode.hasAttribute("data-preserve")) return;
    // An identical subtree has nothing to morph: one native compare instead
    // of walking it. Not while slot ranges are indexed for relocation — a
    // skipped subtree would leave its ranges looking unmatched.
    if (!ranges?.size && oldNode.isEqualNode(newNode)) return;
    morphAttributes(oldNode, newNode, claim);
    reconcileChildren(oldNode, newNode, null, null, claim, ranges, grafts);
  } else if (oldNode.data !== newNode.data) {
    oldNode.data = newNode.data;
  }
}

/** Find a `slot:<id>:start` comment among siblings in `[from, bound)`. */
function findRangeStart(from, id, bound) {
  const target = `slot:${id}:start`;
  let n = from;
  while (n && n !== bound) {
    if (n.nodeType === COMMENT_NODE && n.data === target) return n;
    n = n.nextSibling;
  }
  return null;
}

/** Move the range `[start .. slot:<id>:end]` to before `ref` within `parent`. */
function moveRangeBefore(parent, start, id, ref) {
  const end = slotEnd(id);
  let n = start;
  while (n) {
    const next = n.nextSibling;
    const isEnd = n.nodeType === COMMENT_NODE && n.data === end;
    parent.insertBefore(n, ref);
    if (isEnd) break;
    n = next;
  }
}

/** Place a live range — a stashed fragment or an attached start marker —
 *  before `ref` within `parent`. */
function placeRange(parent, range, id, ref) {
  if (range.nodeType === 11 /* DOCUMENT_FRAGMENT_NODE: stashed range */) {
    parent.insertBefore(range, ref);
  } else {
    moveRangeBefore(parent, range, id, ref);
  }
}

/**
 * Move an incoming slot range from the source into `parent` before
 * `ref`, returning the source cursor just past the range's end marker.
 */
function adoptRange(parent, start, id, ref, claim) {
  const end = slotEnd(id);
  let n = start;
  let after = null;
  while (n) {
    const next = n.nextSibling;
    const isEnd = n.nodeType === COMMENT_NODE && n.data === end;
    parent.insertBefore(n, ref);
    // Fresh server-sent placeholder content: claim indiscriminately (the
    // slot mount that later fills the range claims its own output through
    // compiled creation).
    if (claim) claim(n);
    if (isEnd) {
      after = next;
      break;
    }
    n = next;
  }
  return after;
}

/**
 * Reconcile the children of `parent` toward the children of `source`, reusing
 * existing DOM in place. `source` is a freshly parsed, disposable node whose
 * children are moved into `parent` only when they are genuinely new.
 *
 * When `boundStart`/`boundEnd` are given, only the nodes in `(boundStart,
 * boundEnd)` are reconciled and new nodes are inserted before `boundEnd` —
 * this is how a range-boundary frame reconciles between its markers without
 * touching the client content around them.
 *
 * `ranges` (threaded through the whole recursion from the frame's root apply)
 * indexes the frame content's slot ranges by occurrence id as they stood
 * BEFORE this morph. Occurrence ids are unique within a frame's content, so
 * a range the new content places under a different parent (keyed list churn)
 * is still THAT occurrence — the index is what lets the morph relocate it,
 * live interior intact, where sibling-scoped matching sees only a new id.
 */
export function reconcileChildren(
  parent,
  source,
  boundStart: any = null,
  boundEnd: any = null,
  claim: any = null,
  ranges: any = null,
  grafts: any = null
) {
  let oldChild = boundStart ? boundStart.nextSibling : parent.firstChild;
  let newChild = source.firstChild;

  while (newChild) {
    const nextNew = newChild.nextSibling;
    const pid = slotStartId(newChild);
    // Treat reaching the upper bound as "no more old nodes".
    const old = oldChild === boundEnd ? null : oldChild;

    if (pid !== null) {
      if (old && slotStartId(old) === pid) {
        // Same slot already here: preserve its live interior untouched
        // (this is what keeps focus/selection/media alive) and skip both
        // ranges.
        oldChild = afterRange(old, pid);
        newChild = afterRange(newChild, pid);
      } else {
        // Prefer the frame-wide index (relocations from ANY parent — a
        // removal loop may have stashed the range as a fragment); fall back
        // to the sibling scan when reconciling without one.
        const displaced = ranges && ranges.get(pid);
        const existing = displaced || findRangeStart(old, pid, boundEnd);
        if (existing) {
          if (ranges) ranges.delete(pid);
          // Relocate the existing client-owned range into position.
          placeRange(parent, existing, pid, old ?? boundEnd);
          newChild = afterRange(newChild, pid);
        } else {
          // New slot: adopt the server-sent placeholder range as-is.
          newChild = adoptRange(parent, newChild, pid, old ?? boundEnd, claim);
        }
      }
      continue;
    }

    if (!old) {
      parent.insertBefore(newChild, boundEnd);
      if (claim) claim(newChild);
      if (grafts) grafts.push(newChild);
      newChild = nextNew;
      continue;
    }
    if (isSlotMarker(old)) {
      // Old slot anchor: flow new server content in front of it without
      // disturbing the client-owned range.
      parent.insertBefore(newChild, old);
      if (claim) claim(newChild);
      if (grafts) grafts.push(newChild);
      newChild = nextNew;
      continue;
    }
    if (compatible(old, newChild)) {
      morphNode(old, newChild, claim, ranges, grafts);
      oldChild = old.nextSibling;
      newChild = nextNew;
      continue;
    }
    // A stale text node (a text hole that went empty) holds no client state:
    // drop it so what follows lines up again, instead of relocating the
    // next element in front of it.
    if (old.nodeType === TEXT_NODE && newChild.nodeType !== TEXT_NODE) {
      oldChild = old.nextSibling;
      old.remove();
      continue;
    }
    // Incompatible here — but a compatible element may sit further along:
    // content churn between versions (a placeholder where revealed content
    // was) shifts positions, and recreating a later match would destroy the
    // client-owned interiors it carries. Relocate it instead (skipping over
    // slot-range interiors, which belong to the client).
    if (newChild.nodeType === 1) {
      let ahead = old.nextSibling;
      while (ahead && ahead !== boundEnd && !compatible(ahead, newChild)) {
        const aheadPid = slotStartId(ahead);
        ahead = aheadPid !== null ? afterRange(ahead, aheadPid) : ahead.nextSibling;
      }
      if (ahead && ahead !== boundEnd) {
        parent.insertBefore(ahead, old);
        morphNode(ahead, newChild, claim, ranges, grafts);
        newChild = nextNew;
        continue;
      }
    }
    // No match anywhere: place the new node and leave the old one for later
    // matching or removal.
    parent.insertBefore(newChild, old);
    if (claim) claim(newChild);
    if (grafts) grafts.push(newChild);
    newChild = nextNew;
  }

  while (oldChild && oldChild !== boundEnd) {
    const next = oldChild.nextSibling;
    // A leftover range still in the index hasn't been matched YET — its new
    // position may live in a sibling this level hasn't reached, or deeper in
    // a subtree still to morph. Removing it node-by-node would sever the
    // siblings a later relocation walks, so stash the whole range (order
    // intact) into the index instead. A range nobody ends up claiming just
    // stays detached — exactly what removal meant.
    const pid = ranges ? slotStartId(oldChild) : null;
    if (pid !== null && ranges.get(pid) === oldChild) {
      const frag = document.createDocumentFragment();
      const after = stashRange(frag, oldChild, pid);
      ranges.set(pid, frag);
      oldChild = after;
      continue;
    }
    parent.removeChild(oldChild);
    oldChild = next;
  }
}

/**
 * Identity-first grafting (DR-5): a wholesale-inserted source subtree (a
 * new parent with no old counterpart) carries the source's own bare marker
 * pairs for the slot occurrences it contains — but occurrence identity,
 * not position, owns client ranges, so the reconcile records every such
 * subtree root at insertion, and this walk swaps each bare pair whose
 * occurrence still has a live range in the index (attached under a
 * departed old parent, or stashed as a fragment by the removal loop) for
 * that range — interior, and the client state mounted in it, intact.
 * Recording-at-insert is what makes "a live range was detached because its
 * parent didn't match" an unreachable state: every place a live range
 * could be owed is on the list by construction, no full-frame repair scan
 * to miss a case. The swap runs AFTER the reconcile — the range may still
 * be attached at (or after) a sibling cursor mid-walk, and moving it out
 * from under the cursor would corrupt the walk; by flush time every cursor
 * is dead and the removal loop has stashed whatever it reached. Same
 * traversal rules as the index (descend server-owned elements, never range
 * interiors or nested frames — those are child-owned). Index entries no
 * graft site claims just stay detached — exactly what removal meant.
 */
function flushGrafts(node, ranges) {
  if (node.nodeType !== ELEMENT_NODE || isFrameElement(node)) return;
  let n = node.firstChild;
  while (n) {
    const id = slotStartId(n);
    if (id !== null) {
      const next = afterRange(n, id);
      const displaced = ranges.get(id);
      if (displaced) {
        ranges.delete(id);
        placeRange(node, displaced, id, n);
        // Detach the fresh (bare) marker pair the source shipped.
        stashRange(document.createDocumentFragment(), n, id);
      }
      n = next;
      continue;
    }
    flushGrafts(n, ranges);
    n = n.nextSibling;
  }
}

/**
 * Detach the range `[start .. slot:<id>:end]` into `frag` preserving sibling
 * order; returns the node that followed the range's end marker.
 */
function stashRange(frag, start, id) {
  const end = slotEnd(id);
  let n = start;
  while (n) {
    const next = n.nextSibling;
    const isEnd = n.nodeType === COMMENT_NODE && n.data === end;
    frag.appendChild(n);
    if (isEnd) return next;
    n = next;
  }
  return null;
}
