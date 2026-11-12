// @ts-nocheck
// Slightly modified version of: https://github.com/WebReflection/udomdiff/blob/master/index.js
import { $$SLOT, $$INDEX } from "./constants.js";

export default function reconcileArrays(
  parentNode: Node,
  a: Node[],
  b: Node[],
  marker?: Node | null
): void;
export default function reconcileArrays(parentNode: any, a: any[], b: any[], marker?: any) {
  let bLength = b.length,
    aEnd = a.length,
    bEnd = bLength,
    aStart = 0,
    bStart = 0,
    stamped,
    after,
    index,
    anchor;

  // Same nodes (a text hole updated in place): return before the setup below.
  while (aStart < aEnd && a[aStart] === b[bStart]) {
    aStart++;
    bStart++;
  }
  if (aStart === aEnd && bStart === bEnd) return;
  // Connected nodes move with `moveBefore()` where the browser has it: the
  // node stays connected, so focus and other node state survive (#3997), and
  // a reorder is a place rather than a detach and reattach. Placing every
  // node this way, and never `replaceChild()`, took dbmon's 1,000-row sort
  // from ~2.0 ms to ~0.75 ms. New nodes are not connected and take
  // `insertBefore()`. It throws for a detached parent, hence the parent check.
  const mv = parentNode.moveBefore && parentNode.isConnected;
  // A markerless hole retags with its parent, so a tag from another slot never sticks.
  const slot = marker || parentNode;
  const insert = (n, ref) => {
    mv && n.isConnected ? parentNode.moveBefore(n, ref) : parentNode.insertBefore(n, ref);
    if (marker || n[$$SLOT]) n[$$SLOT] = slot;
  };
  // First mount: skip the diff's setup, which cost spa-navigation mounts ~8%.
  if (!aEnd) {
    for (const n of b) insert(n, marker);
    return;
  }
  // Ownership: an unclaimed node (no `$$SLOT`) is fair game; a tagged node
  // belongs only to the slot whose marker matches. `a[]` can name a node that
  // user code moved out of this parent (or into another slot of it); every
  // anchor read and destructive op below checks before touching one.
  const isLive = n => n && n.parentNode === parentNode && (!(n = n[$$SLOT]) || n === slot);
  // Anchor on the first suffix node still ours (user code can move one
  // away), else `after`. Not on the last placed node's successor: that
  // can be an old node the replace below left waiting in place.
  const ref = k => {
    while (k < bLength && !isLive(b[k])) k++;
    // `after` can be a list node user code moved past the tail, which this pass has taken out.
    return b[k] || (after && after.parentNode !== parentNode ? marker || null : after);
  };
  // If `a`'s tail has migrated to another slot — same parent or otherwise —
  // its `nextSibling` points into a region we don't own, so fall back to
  // `marker`. `marker || null` keeps non-multi (root-mode) callers happy.
  after = isLive((anchor = a[aEnd - 1])) ? anchor.nextSibling : marker || null;

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
      anchor = ref(bEnd);
      while (bStart < bEnd) insert(b[bStart++], anchor);
      // An old node that is no longer ours holds no position in this region:
      // it can neither be replaced nor anchor an insert — both used to put the
      // new node at the region's end, out of order. Consume it and let the new
      // node land when its own turn comes.
    } else if (!isLive((anchor = a[aStart]))) aStart++;
    // swap backward — symmetric end-swap detected. Walk inward with a single
    // stable front anchor (a[aStart]); each move targets the same DOM-position
    // so the browser's adjacency cache stays warm and per-call native
    // `insertBefore` cost drops sharply on reorder-heavy patterns (e.g. reverse).
    else if (
      b[bStart] === a[aEnd - 1] &&
      // End swap: the front node is also wanted at the back.
      (anchor === b[bEnd - 1] ||
        // Rotate: only the back node moved, and the front two follow it in order.
        // Not once the map branch has placed nodes.
        (!stamped && anchor === b[bStart + 1] && a[aStart + 1] === b[bStart + 2]))
    ) {
      // Tightest inner loop in the file; one `insertBefore` per iter plus an
      // end-condition probe. One loop for both kinds of hole: `insert` tags, and
      // a markerless hole must retag here too.
      do {
        insert(a[--aEnd], anchor);
        bStart++;
      } while (
        aStart < aEnd - 1 &&
        bStart < bEnd &&
        anchor === b[bEnd - 1] &&
        b[bStart] === a[aEnd - 1]
      );
      // Only the front node moved to the back: one move. A reversed run is left to the map.
    } else if (
      bStart < bEnd &&
      anchor === b[bEnd - 1] &&
      a[aStart + 1] !== b[bEnd - 2] &&
      isLive(b[bStart]) &&
      isLive(a[aEnd - 1])
    ) {
      insert(anchor, ref(bEnd));
      aStart++;
      bEnd--;
      // fallback to map; with nothing left in `b` it removes what is not placed
    } else {
      // The map is an index stamp on each new node, checked against `b` on read.
      if (!stamped) {
        stamped = 1;
        for (index = bStart; index < bEnd; ) b[index][$$INDEX] = index++;
      }

      if ((index = anchor[$$INDEX]) >= 0 && b[index] === anchor) {
        if (bStart < index && index < bEnd) {
          let i = aStart,
            sequence = 1;

          while (++i < aEnd && i < bEnd && a[i] === b[index + sequence]) sequence++;

          if (sequence > index - bStart) {
            while (bStart < index) insert(b[bStart++], anchor);
          } else {
            // `replaceChild` detaches the old node, which is placed again
            // later in this pass. With `moveBefore()`, insert instead and
            // leave the old node waiting in place, connected.
            const newNode = b[bStart++];
            aStart++;
            mv ? insert(newNode, anchor) : parentNode.replaceChild(newNode, anchor);
            if (marker || newNode[$$SLOT]) newNode[$$SLOT] = slot;
          }
        } else aStart++;
      } else {
        anchor.remove();
        aStart++;
      }
    }
  }
}
