// @ts-nocheck
// Slightly modified version of: https://github.com/WebReflection/udomdiff/blob/master/index.js
import { $$SLOT } from "./constants.js";

// Moves keep the node holding focus connected with `moveBefore()` where the
// browser has it, so focus survives (#3997). Other nodes take plain
// `insertBefore()`: `moveBefore()` for every node cost whole-list reorders
// 4–8% once layout ran. Both ends must be connected or `moveBefore()` throws;
// `node.isConnected` first also keeps new nodes off the focus check.
const canMove = (parent: any, node: any) =>
  node.isConnected && parent.isConnected && node.contains(document.activeElement);

// Whether a pass might move the node holding focus, read once per pass and
// passed to every insert as `keep`. With no `moveBefore()`, or focus on the
// body, no node can need it and no insert checks focus: checking per node cost
// whole-list reorders 5–15%. Focus anywhere else, including outside this
// parent (a node can arrive from another list), checks per node.
export const mayKeepFocus = (parent: any, active?: any) =>
  parent.moveBefore && (active = document.activeElement) && active !== document.body;

export const insertNode = (parent: any, node: any, ref: any, keep: any) =>
  keep && canMove(parent, node) ? parent.moveBefore(node, ref) : parent.insertBefore(node, ref);

export default function reconcileArrays(
  parentNode: Node,
  a: Node[],
  b: Node[],
  marker?: Node | null
): void;
export default function reconcileArrays(parentNode: any, a: any[], b: any[], marker?: any) {
  const keep = mayKeepFocus(parentNode);
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
      let node;
      if (bEnd < bLength) {
        // The walks no longer check liveness, so the prefix node before the
        // insert and the suffix's first node can each be one user code moved
        // away: anchoring on it threw (NotFoundError) or, falling back to
        // `after`, landed the insert past the live suffix. Anchor on the last
        // live prefix node's successor, else the first suffix node still ours.
        if (bStart && isLive((node = b[bStart - 1]))) node = node.nextSibling;
        else {
          let k = bEnd;
          while (k < bLength && !isLive(b[k])) k++;
          node = k < bLength ? b[k] : after;
        }
      } else node = after;

      while (bStart < bEnd) {
        const n = b[bStart++];
        insertNode(parentNode, n, node, keep);
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
          insertNode(parentNode, n, anchor, keep);
          n[$$SLOT] = marker;
          bStart++;
          if (aStart >= aEnd - 1 || bStart >= bEnd) break;
        } while (a[aStart] === b[bEnd - 1] && b[bStart] === a[aEnd - 1]);
      } else {
        do {
          insertNode(parentNode, a[--aEnd], anchor, keep);
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
              insertNode(parentNode, n, node, keep);
              if (marker) n[$$SLOT] = marker;
            }
          } else {
            const newNode = b[bStart++],
              node = a[aStart++];
            // `replaceChild` detaches both nodes when `newNode` is connected,
            // and `node` is placed again later in this pass, so either can
            // lose focus. While focus is in the list, `node` waits at the
            // region's end instead: every node still to place is inserted
            // before a node that precedes it, or before `after` in order, so
            // it can't anchor an insert.
            if (keep && canMove(parentNode, parentNode)) {
              insertNode(parentNode, newNode, node, keep);
              insertNode(parentNode, node, after, keep);
            } else parentNode.replaceChild(newNode, node);
            if (marker) newNode[$$SLOT] = marker;
          }
        } else aStart++;
      } else a[aStart++].remove();
    }
  }
}
