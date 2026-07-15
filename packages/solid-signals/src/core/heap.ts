import {
  EFFECT_TRACKED,
  EFFECT_USER,
  REACTIVE_CHECK,
  REACTIVE_DIRTY,
  REACTIVE_IN_HEAP,
  REACTIVE_IN_HEAP_HEIGHT,
  REACTIVE_MANUAL_WRITE,
  REACTIVE_RECOMPUTING_DEPS,
  REACTIVE_ZOMBIE
} from "./constants.js";
import { dirtyQueue, zombieQueue } from "./scheduler.js";
import type { Computed, FirewallSignal, Root } from "./types.js";

/** The queue a node belongs to, picked from its own zombie flag. */
export function queueFor(n: Computed<any>): Heap {
  return n._flags & REACTIVE_ZOMBIE ? zombieQueue : dirtyQueue;
}

/**
 * Schedule one subscriber to re-run on the next flush: tracked effects bypass
 * the heap and go directly to their effect queue; everything else is inserted
 * into its own (zombie-flag-routed) heap with the `_min` cursor pulled down.
 */
export function enqueueSub(node: Computed<any>): void {
  if ((node as any)._type === EFFECT_TRACKED) {
    const tracked = node as any;
    if (!tracked._modified) {
      tracked._modified = true;
      tracked._queue.enqueue(EFFECT_USER, tracked._run);
    }
    return;
  }
  const queue = queueFor(node);
  if (queue._min > node._height) queue._min = node._height;
  insertIntoHeap(node, queue);
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
  if (flags & (REACTIVE_IN_HEAP | REACTIVE_RECOMPUTING_DEPS | REACTIVE_MANUAL_WRITE)) return;
  if (flags & REACTIVE_CHECK) {
    n._flags = (flags & ~(REACTIVE_CHECK | REACTIVE_DIRTY)) | REACTIVE_DIRTY | REACTIVE_IN_HEAP;
  } else n._flags = flags | REACTIVE_IN_HEAP;
  if (!(flags & REACTIVE_IN_HEAP_HEIGHT)) actualInsertIntoHeap(n, heap);
}

export function insertIntoHeapHeight(n: Computed<unknown>, heap: Heap) {
  let flags = n._flags;
  if (
    flags &
    (REACTIVE_IN_HEAP | REACTIVE_RECOMPUTING_DEPS | REACTIVE_IN_HEAP_HEIGHT | REACTIVE_MANUAL_WRITE)
  )
    return;
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
  if (el._child !== null) {
    for (
      let child: FirewallSignal<unknown> | null = el._child;
      child !== null;
      child = child._nextChild
    ) {
      for (let link = child._subs; link !== null; link = link._nextSub) {
        markNode(link._sub, REACTIVE_CHECK);
      }
    }
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
    const dep1 = d._dep;
    const dep = (dep1 as FirewallSignal<unknown>)._firewall || dep1;
    if ((dep as Computed<unknown>)._fn && dep._height >= newHeight) newHeight = dep._height + 1;
  }
  if (el._height !== newHeight) {
    el._height = newHeight;
    for (let s = el._subs; s !== null; s = s._nextSub) {
      // Route each subscriber by its own zombie flag, mirroring the
      // post-recompute height-adjust path. Inserting into the running `heap`
      // unconditionally can park a zombie in `dirtyQueue` (or a live node in
      // `zombieQueue`), breaking the flag/queue invariant `deleteFromHeap`
      // relies on — the same corruption class as #2759.
      insertIntoHeapHeight(s._sub, queueFor(s._sub));
    }
  }
}
