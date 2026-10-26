// @ts-nocheck
// Slightly modified version of: https://github.com/WebReflection/udomdiff/blob/master/index.js
import { $$SLOT } from "./constants.js";

export default function reconcileArrays(
  parentNode: Node,
  a: Node[],
  b: Node[],
  marker?: Node | null
): void;
export default function reconcileArrays(parentNode: any, a: any[], b: any[], marker?: any) {
  // Moves keep the node holding focus connected with `moveBefore()` where
  // the browser has it, so focus survives (#3997). Focus is read once per
  // pass, and not at all without `moveBefore()` or with focus on the body.
  // Only a connected node that holds focus takes `moveBefore()`: using it for
  // every node cost whole-list reorders 4–8% once layout ran, and checking
  // `isConnected` first keeps new nodes off the focus check. It throws for a
  // detached parent, hence the `isConnected` check on the parent.
  let active = parentNode.moveBefore && parentNode.isConnected && document.activeElement;
  if (active === document.body) active = null;
  const insert = (n, ref) =>
    active && n.isConnected && n.contains(active)
      ? parentNode.moveBefore(n, ref)
      : parentNode.insertBefore(n, ref);
  // Ownership: an unclaimed node (no `$$SLOT`) is fair game; a tagged node
  // belongs only to the slot whose marker matches. `a[]` can name a node that
  // user code moved out of this parent (or into another slot of it); every
  // anchor read and destructive op below checks before touching one.
  const isLive = n => {
    if (!n) return false;
    const tag = n[$$SLOT];
    return n.parentNode === parentNode && (!tag || tag === marker);
  };
  let bLength = b.length,
    aEnd = a.length,
    bEnd = bLength,
    aStart = 0,
    bStart = 0,
    tail = a[aEnd - 1],
    // If `a`'s tail has migrated to another slot — same parent or otherwise —
    // `tail.nextSibling` points into a region we don't own, so fall back to
    // `marker`. `marker || null` keeps non-multi (root-mode) callers happy.
    after = isLive(tail) ? tail.nextSibling : marker || null,
    map = null,
    anchor,
    anchorTag;

  while (aStart < aEnd || bStart < bEnd) {
    // common prefix / suffix. Neither walk checks liveness: inside the open
    // range [aStart, aEnd) this pass never detaches a node (replace, remove
    // and swap all consume the node they take out), and a node user code
    // migrated away is left alone by skipping it here — every destructive
    // branch below still gates on ownership. The suffix walk is bounded to
    // the open range: unbounded, it could reach back past `aStart` to a node
    // a map-branch replace had already taken out while it was still pending
    // in `b`, count it as a live common end, and never reinsert it (#574).
    if (a[aStart] === b[bStart]) {
      aStart++;
      bStart++;
      continue;
    }
    while (aEnd > aStart && bEnd > bStart && a[aEnd - 1] === b[bEnd - 1]) {
      aEnd--;
      bEnd--;
    }
    // append
    if (aEnd === aStart) {
      // Anchor on the first suffix node still ours (user code can move one
      // away), else `after`. Not on the last placed node's successor: that
      // can be an old node the replace below left waiting in place.
      let k = bEnd;
      while (k < bLength && !isLive(b[k])) k++;
      const node = k < bLength ? b[k] : after;

      while (bStart < bEnd) {
        const n = b[bStart++];
        insert(n, node);
        if (marker) n[$$SLOT] = marker;
      }
      // remove
    } else if (bEnd === bStart) {
      while (aStart < aEnd) {
        const n = a[aStart++];
        if ((!map || !map.has(n)) && isLive(n)) n.remove();
      }
      // swap backward — symmetric end-swap detected. Walk inward with a single
      // stable front anchor (a[aStart]); each move targets the same DOM-position
      // so the browser's adjacency cache stays warm and per-call native
      // `insertBefore` cost drops sharply on reorder-heavy patterns (e.g. reverse).
      // Only optimize when the anchor still belongs to us; otherwise fall through
      // to the map branch which gates each destructive op. The anchor and its
      // tag are read once per detected swap and reused — important on hot
      // reorder benches (`reconcile-permute reverse`) where this branch fires
      // on every inner-loop step.
    } else if (
      (anchor = a[aStart]) === b[bEnd - 1] &&
      b[bStart] === a[aEnd - 1] &&
      anchor.parentNode === parentNode &&
      (!(anchorTag = anchor[$$SLOT]) || anchorTag === marker)
    ) {
      // Tightest inner loop in the file; one `insertBefore` per iter plus an
      // end-condition probe. Splitting on `marker` avoids a per-iter branch in
      // the hot path — js-framework-benchmark `05_swap1k` regresses ~6.5% when
      // this is collapsed (validated 2026-05-16 on Chrome headless).
      if (marker) {
        do {
          const n = a[--aEnd];
          insert(n, anchor);
          n[$$SLOT] = marker;
          bStart++;
          if (aStart >= aEnd - 1 || bStart >= bEnd) break;
        } while (a[aStart] === b[bEnd - 1] && b[bStart] === a[aEnd - 1]);
      } else {
        do {
          insert(a[--aEnd], anchor);
          bStart++;
          if (aStart >= aEnd - 1 || bStart >= bEnd) break;
        } while (a[aStart] === b[bEnd - 1] && b[bStart] === a[aEnd - 1]);
      }
      // fallback to map
    } else {
      // An old node that is no longer ours holds no position in this region:
      // it can neither be replaced nor anchor an insert — both used to put the
      // new node at the region's end, out of order. Consume it and let the new
      // node land when its own turn comes.
      if (!isLive(a[aStart])) {
        aStart++;
        continue;
      }
      if (!map) {
        map = new Map();
        let i = bStart;

        while (i < bEnd) map.set(b[i], i++);
      }

      const index = map.get(a[aStart]);
      if (index != null) {
        if (bStart < index && index < bEnd) {
          let i = aStart,
            sequence = 1,
            t;

          while (++i < aEnd && i < bEnd) {
            if ((t = map.get(a[i])) == null || t !== index + sequence) break;
            sequence++;
          }

          if (sequence > index - bStart) {
            const node = a[aStart];
            while (bStart < index) {
              const n = b[bStart++];
              insert(n, node);
              if (marker) n[$$SLOT] = marker;
            }
          } else {
            // `replaceChild` detaches the old node, which is placed again
            // later in this pass. While focus is in the list, insert instead
            // and leave the old node waiting in place, so it keeps focus.
            const newNode = b[bStart++],
              node = a[aStart++];
            active && parentNode.contains(active)
              ? insert(newNode, node)
              : parentNode.replaceChild(newNode, node);
            if (marker) newNode[$$SLOT] = marker;
          }
        } else aStart++;
      } else a[aStart++].remove();
    }
  }
}
