import { ext } from "./core.js";
import {
  REACTIVE_CHECK,
  REACTIVE_DIRTY,
  REACTIVE_IN_HEAP,
  REACTIVE_IN_HEAP_HEIGHT,
  REACTIVE_RECOMPUTING_DEPS
} from "./constants.js";
import { dirtyQueue } from "./scheduler.js";
import type { Computed, Root } from "./types.js";

/**
 * Schedule one subscriber to re-run on the next flush: inserted into the
 * dirty heap with the `_min` cursor pulled down. Tracked effects ride the
 * heap too — the heap visit is their (empty) compute phase, which hands the
 * callback to the user queue once the pass has committed (see
 * GlobalQueue._update, #3291).
 */
export function enqueueSub(node: Computed<any>): void {
  if (dirtyQueue._min > node._height) dirtyQueue._min = node._height;
  insertIntoHeap(node, dirtyQueue);
}

export interface Heap {
  _heap: (Computed<unknown> | undefined)[];
  _marked: boolean;
  _min: number;
  _max: number;
}

export function increaseHeapSize(n: number, heap: Heap): void {
  if (n > heap._heap.length) {
    heap._heap.length = n;
  }
}

function actualInsertIntoHeap(n: Computed<unknown>, heap: Heap) {
  const parentHeight =
    ((n._parent as Root)?._root
      ? (n._parent as Root)._parentComputed?._height
      : (n._parent as Computed<any> | null)?._height) ?? -1;
  if (parentHeight >= n._height) n._height = parentHeight + 1;
  const height = n._height;
  const heapAtHeight = heap._heap[height];
  if (heapAtHeight === undefined) heap._heap[height] = n;
  else {
    const tail = heapAtHeight._prevHeap;
    tail._nextHeap = n;
    n._prevHeap = tail;
    heapAtHeight._prevHeap = n;
  }
  if (height > heap._max) heap._max = height;
}
export function insertIntoHeap(n: Computed<any>, heap: Heap) {
  let flags = n._flags;
  // RECOMPUTING refusals are not always losses: a genuinely missed wake (a
  // write to a link this pass already validated) is latched link-side in
  // insertSubs as REACTIVE_MISSED_WAKE for recompute's tail (#3037).
  if (flags & (REACTIVE_IN_HEAP | REACTIVE_RECOMPUTING_DEPS)) return;
  if (flags & REACTIVE_CHECK) {
    n._flags = (flags & ~(REACTIVE_CHECK | REACTIVE_DIRTY)) | REACTIVE_DIRTY | REACTIVE_IN_HEAP;
  } else {
    n._flags = flags | REACTIVE_IN_HEAP;
    // An unmarked node entering an already-marked heap is marked on the
    // spot, keeping the markHeap memo valid. `_marked` is only reset by
    // runHeap, so a write between two mid-tick pulls (read-time markHeap +
    // updateIfNecessary) would otherwise leave this node unmarked and every
    // downstream pull stale until the next flush (#2922: the second
    // `latest()` returned the first write's value). Invalidating the memo
    // instead re-walked the WHOLE heap on the next pull — with N effects
    // parked in the heap for a synchronous mount (each row writing a ref
    // signal its effect subscribes to), mounting N rows was O(N²) (#3350).
    // markNode's own guard skips an already-DIRTY node.
    if (heap._marked) markNode(n);
  }
  if (!(flags & REACTIVE_IN_HEAP_HEIGHT)) actualInsertIntoHeap(n, heap);
}

export function insertIntoHeapHeight(n: Computed<unknown>, heap: Heap) {
  let flags = n._flags;
  if (flags & (REACTIVE_IN_HEAP | REACTIVE_RECOMPUTING_DEPS | REACTIVE_IN_HEAP_HEIGHT)) return;
  n._flags = flags | REACTIVE_IN_HEAP_HEIGHT;
  actualInsertIntoHeap(n, heap);
}

export function deleteFromHeap(n: Computed<unknown>, heap: Heap) {
  const flags = n._flags;
  if (!(flags & (REACTIVE_IN_HEAP | REACTIVE_IN_HEAP_HEIGHT))) return;
  n._flags = flags & ~(REACTIVE_IN_HEAP | REACTIVE_IN_HEAP_HEIGHT);
  const height = n._height;
  if (n._prevHeap === n) heap._heap[height] = undefined;
  else {
    const next = n._nextHeap;
    const dhh = heap._heap[height]!;
    const end = next ?? dhh;
    if (n === dhh) heap._heap[height] = next;
    else n._prevHeap._nextHeap = next;
    end._prevHeap = n._prevHeap;
  }
  n._prevHeap = n;
  n._nextHeap = undefined;
}

export function markHeap(heap: Heap) {
  if (heap._marked) return;
  heap._marked = true;
  for (let i = 0; i <= heap._max; i++) {
    for (let el = heap._heap[i]; el !== undefined; el = el._nextHeap) {
      if (el._flags & REACTIVE_IN_HEAP) markNode(el);
    }
  }
}

export function markNode(el: Computed<unknown>, newState = REACTIVE_DIRTY) {
  const flags = el._flags;
  if ((flags & (REACTIVE_CHECK | REACTIVE_DIRTY)) >= newState) return;
  el._flags = (flags & ~(REACTIVE_CHECK | REACTIVE_DIRTY)) | newState;
  for (let link = el._subs; link !== null; link = link._nextSub) {
    markNode(link._sub, REACTIVE_CHECK);
  }
}

export function runHeap(heap: Heap, recompute: (el: Computed<unknown>) => void): void {
  heap._marked = false;
  for (heap._min = 0; heap._min <= heap._max; heap._min++) {
    let el = heap._heap[heap._min];
    while (el !== undefined) {
      if (el._flags & REACTIVE_IN_HEAP) recompute(el);
      else adjustHeight(el, heap);
      el = heap._heap[heap._min];
    }
  }
  heap._max = 0;
}

function adjustHeight(el: Computed<unknown>, heap: Heap) {
  deleteFromHeap(el, heap);
  let newHeight = el._height;
  for (let d = el._deps; d; d = d._nextDep) {
    const dep = d._dep;
    if ((dep as Computed<unknown>)._fn && (dep as Computed<unknown>)._height >= newHeight)
      newHeight = (dep as Computed<unknown>)._height + 1;
  }
  if (el._height !== newHeight) {
    el._height = newHeight;
    for (let s = el._subs; s !== null; s = s._nextSub) insertIntoHeapHeight(s._sub, heap);
  }
}
