import { setStrictRead } from "./core/core.js";
import { listArray } from "./list.js";
import {
  computed,
  CONFIG_AUTO_DISPOSE,
  createOwner,
  getOwner,
  runWithOwner,
  setSignal,
  signal,
  type Root,
  type Signal
} from "./core/index.js";
import { accessor, type Accessor } from "./signals.js";

export type Maybe<T> = T | void | null | undefined | false;

/**
 * Reactively maps an array, reusing the previously-mapped value for unchanged
 * items.
 *
 * The callback shape follows the keying mode:
 * - default / `keyed: true` receives `(item, index)` where `item` is the raw
 *   row value and `index` is an accessor.
 * - `keyed: false` receives `(item, index)` where `item` is an accessor and
 *   `index` is a stable number.
 * - `keyed: item => key` receives accessors for both arguments.
 *
 * This is the underlying helper that powers `<For>`. App code should use
 * `<For>` directly; reach for `mapArray` when implementing custom list
 * components.
 *
 * - `options.keyed` — `true` (default for primitives) compares by identity;
 *   `false` falls back to index-only mapping; pass a function `(item) => key`
 *   for stable identity by extracted key.
 * - `options.fallback` — accessor returning a value to show when the input is
 *   empty.
 *
 * @example
 * ```ts
 * const view = mapArray(
 *   items,
 *   (item, index) => `${index()}: ${item.label}`,
 *   { fallback: () => "no items" }
 * );
 * ```
 *
 * @description https://docs.solidjs.com/reference/reactive-utilities/map-array
 */
export function mapArray<Item, MappedItem>(
  list: Accessor<Maybe<readonly Item[]>>,
  map: (value: Item, index: Accessor<number>) => MappedItem,
  options?: { keyed?: true; fallback?: Accessor<any>; name?: string }
): Accessor<MappedItem[]>;
export function mapArray<Item, MappedItem>(
  list: Accessor<Maybe<readonly Item[]>>,
  map: (value: Accessor<Item>, index: number) => MappedItem,
  options: { keyed: false; fallback?: Accessor<any>; name?: string }
): Accessor<MappedItem[]>;
export function mapArray<Item, MappedItem>(
  list: Accessor<Maybe<readonly Item[]>>,
  map: (value: Accessor<Item>, index: Accessor<number>) => MappedItem,
  options: { keyed: (item: Item) => any; fallback?: Accessor<any>; name?: string }
): Accessor<MappedItem[]>;
export function mapArray<Item, MappedItem>(
  list: Accessor<Maybe<readonly Item[]>>,
  map:
    | ((value: Item, index: Accessor<number>) => MappedItem)
    | ((value: Accessor<Item>, index: number) => MappedItem)
    | ((value: Accessor<Item>, index: Accessor<number>) => MappedItem),
  options?: {
    keyed?: boolean | ((item: Item) => any);
    fallback?: Accessor<any>;
    name?: string;
    /** @internal defer the first mapping pass to the first read. */
    lazy?: boolean;
  }
): Accessor<MappedItem[]> {
  // The list ENGINE's array output (list.ts) — one implementation shared with
  // <For>'s rendered output.
  return listArray({
    each: list,
    row: map as any,
    keyed: options?.keyed,
    fallback: options?.fallback,
    owner: getOwner(),
    name: options?.name,
    lazy: options?.lazy
  }) as Accessor<MappedItem[]>;
}

/**
 * Reactively renders a callback `count` times, reusing previously-rendered
 * entries when only the count changes. Underlying helper for `<Repeat>`.
 *
 * - `options.from` — start index (default `0`); useful for offset/windowed
 *   rendering.
 * - `options.fallback` — accessor returning a value to show when count is `0`.
 *
 * @example
 * ```ts
 * const view = repeat(count, i => `Item ${i}`, { fallback: () => "empty" });
 * ```
 *
 * @description https://docs.solidjs.com/reference/reactive-utilities/repeat
 */
export function repeat(
  count: Accessor<number>,
  map: (index: number) => any,
  options?: {
    from?: Accessor<number | undefined>;
    fallback?: Accessor<any>;
    name?: string;
  }
): Accessor<any[]> {
  const wrappedMap =
    __DEV__ && options?.name
      ? (i: number) => {
          setStrictRead(options!.name!);
          try {
            return map(i);
          } finally {
            setStrictRead(false);
          }
        }
      : map;
  const data: RepeatData = {
    _owner: createOwner(),
    _len: 0,
    _offset: 0,
    _count: count,
    _map: wrappedMap,
    _nodes: [],
    _mappings: [],
    _from: options?.from,
    _fallback: options?.fallback
  };
  const node = computed(updateRepeat.bind(data));
  // Same as mapArray: untracked reads inside the internal owner resolve via
  // _parentComputed, so async reads in row callbacks register with the node
  // (pending tracking + post-settle retry) instead of vanishing.
  data._owner._parentComputed = node;
  node._config &= ~CONFIG_AUTO_DISPOSE;
  return accessor(node);
}

// Same staged-commit discipline as `updateKeyedMap` (#2903): the retained
// window overlap is copied into fresh arrays, missing indexes are created
// into them, and `this` is only touched — including disposal of rows leaving
// the window — after every `_map` call succeeded. A NotReadyError mid-pass
// disposes only the owners this pass created and leaves prior state intact
// for the post-settle retry. The overlap math also subsumes the previous
// disjoint-window/front-clear/end-clear/shift special cases.
function updateRepeat<MappedItem>(this: RepeatData<MappedItem>): any[] {
  const newLen = this._count();
  const from = this._from?.() || 0;
  runWithOwner(this._owner, () => {
    if (newLen === 0) {
      if (this._len !== 0) {
        this._owner.dispose(false);
        this._nodes = [];
        this._mappings = [];
        this._len = 0;
        // Reset offset to match the cleared data (#2767, repro 2).
        this._offset = 0;
      }
      if (this._fallback && !this._mappings[0]) {
        // an aborted fallback attempt leaves an owner without a mapping;
        // dispose it before re-creating
        this._nodes[0]?.dispose();
        this._mappings[0] = runWithOwner<MappedItem>(
          (this._nodes[0] = createOwner()),
          this._fallback
        );
      }
      return;
    }
    const to = from + newLen;
    const prevTo = this._offset + this._len;
    // Retained overlap [keepStart, keepEnd) in global indexes; empty when the
    // windows are disjoint or when coming from empty/fallback.
    const keepStart = Math.max(from, this._offset);
    const keepEnd = Math.min(to, prevTo);

    const mappings: MappedItem[] = new Array(newLen);
    const nodes: Root[] = new Array(newLen);
    for (let i = keepStart; i < keepEnd; i++) {
      nodes[i - from] = this._nodes[i - this._offset];
      mappings[i - from] = this._mappings[i - this._offset];
    }
    try {
      for (let i = from; i < to; i++) {
        if (i >= keepStart && i < keepEnd) continue;
        mappings[i - from] = runWithOwner<MappedItem>((nodes[i - from] = createOwner()), () =>
          this._map(i)
        )!;
      }
    } catch (err) {
      for (let i = from; i < to; i++)
        if ((i < keepStart || i >= keepEnd) && nodes[i - from]) nodes[i - from].dispose();
      throw err;
    }

    // commit: dispose the previous fallback or the rows leaving the window
    if (this._len === 0) this._nodes[0]?.dispose();
    else
      for (let i = this._offset; i < prevTo; i++)
        if (i < from || i >= to) this._nodes[i - this._offset].dispose();
    this._mappings = mappings;
    this._nodes = nodes;
    this._offset = from;
    this._len = newLen;
  });
  return this._mappings;
}

interface RepeatData<MappedItem = any> {
  _owner: Root;
  _len: number;
  _count: Accessor<number>;
  _map: (index: number) => MappedItem;
  _mappings: MappedItem[];
  _nodes: Root[];
  _offset: number;
  _from?: Accessor<number | undefined>;
  _fallback?: Accessor<any>;
}
