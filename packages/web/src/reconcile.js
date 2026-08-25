// Slightly modified version of: https://github.com/WebReflection/udomdiff/blob/master/index.js
import { $$SLOT } from "./constants";

export default function reconcileArrays(parentNode, a, b, marker) {
  let bLength = b.length,
    aEnd = a.length,
    bEnd = bLength,
    aStart = 0,
    bStart = 0,
    tail = a[aEnd - 1],
    tailTag = tail[$$SLOT],
    // Ownership tag: an unclaimed node (no `$$SLOT`) is fair game; a tagged
    // node belongs only to the slot whose marker matches. If `a`'s tail has
    // migrated to another slot — same parent or otherwise — `tail.nextSibling`
    // points into a region we don't own, so fall back to `marker`. `marker ||
    // null` keeps non-multi (root-mode) callers happy.
    after =
      tail.parentNode === parentNode && (!tailTag || tailTag === marker)
        ? tail.nextSibling
        : marker || null,
    map = null,
    anchor,
    anchorTag;

  // `a[]` can name a node that replace/swap already took out of this
  // parent (or out of this slot). Prefix/suffix must not treat those as
  // still-live common ends — that was the 2fe6310f drop (#574).
  const isLive = n => {
    if (!n) return false;
    const tag = n[$$SLOT];
    return n.parentNode === parentNode && (!tag || tag === marker);
  };

  while (aStart < aEnd || bStart < bEnd) {
    // common prefix
    if (a[aStart] === b[bStart] && isLive(a[aStart])) {
      aStart++;
      bStart++;
      continue;
    }
    // common suffix
    while (a[aEnd - 1] === b[bEnd - 1] && isLive(a[aEnd - 1])) {
      aEnd--;
      bEnd--;
    }
    // append
    if (aEnd === aStart) {
      let node;
      if (bEnd < bLength) {
        if (bStart) {
          const prev = b[bStart - 1];
          const prevTag = prev[$$SLOT];
          node =
            prev.parentNode === parentNode && (!prevTag || prevTag === marker)
              ? prev.nextSibling
              : after;
        } else node = b[bEnd - bStart];
      } else node = after;

      while (bStart < bEnd) {
        const n = b[bStart++];
        parentNode.insertBefore(n, node);
        if (marker) n[$$SLOT] = marker;
      }
      // remove
    } else if (bEnd === bStart) {
      while (aStart < aEnd) {
        const n = a[aStart++];
        if (!map || !map.has(n)) {
          const tag = n[$$SLOT];
          if (n.parentNode === parentNode && (!tag || tag === marker)) n.remove();
        }
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
          parentNode.insertBefore(n, anchor);
          n[$$SLOT] = marker;
          bStart++;
          if (aStart >= aEnd - 1 || bStart >= bEnd) break;
        } while (a[aStart] === b[bEnd - 1] && b[bStart] === a[aEnd - 1]);
      } else {
        do {
          parentNode.insertBefore(a[--aEnd], anchor);
          bStart++;
          if (aStart >= aEnd - 1 || bStart >= bEnd) break;
        } while (a[aStart] === b[bEnd - 1] && b[bStart] === a[aEnd - 1]);
      }
      // fallback to map
    } else {
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
            const head = a[aStart];
            const headTag = head[$$SLOT];
            const node =
              head.parentNode === parentNode && (!headTag || headTag === marker) ? head : after;
            while (bStart < index) {
              const n = b[bStart++];
              parentNode.insertBefore(n, node);
              if (marker) n[$$SLOT] = marker;
            }
          } else {
            const oldNode = a[aStart++];
            const newNode = b[bStart++];
            const oldTag = oldNode[$$SLOT];
            if (oldNode.parentNode === parentNode && (!oldTag || oldTag === marker)) {
              parentNode.replaceChild(newNode, oldNode);
            } else {
              parentNode.insertBefore(newNode, after);
            }
            if (marker) newNode[$$SLOT] = marker;
          }
        } else aStart++;
      } else {
        const n = a[aStart++];
        const nTag = n[$$SLOT];
        if (n.parentNode === parentNode && (!nTag || nTag === marker)) n.remove();
      }
    }
  }
}
