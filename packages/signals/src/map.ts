import { setStrictRead } from "./core/core.js";
import {
  computed,
  CONFIG_AUTO_DISPOSE,
  createOwner,
  runWithOwner,
  setSignal,
  signal,
  type Root,
  type Signal
} from "./core/index.js";
import { accessor, type Accessor } from "./signals.js";
import { $TRACK } from "./store/index.js";

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
  options?: { keyed?: boolean | ((item: Item) => any); fallback?: Accessor<any>; name?: string }
): Accessor<MappedItem[]> {
  const keyFn = typeof options?.keyed === "function" ? options.keyed : undefined;
  const indexes = map.length > 1;
  const wrappedMap =
    __DEV__ && options?.name
      ? (((...args: any[]) => {
          setStrictRead(options!.name!);
          try {
            return (map as any)(...args);
          } finally {
            setStrictRead(false);
          }
        }) as typeof map)
      : map;
  const data: MapData<Item, MappedItem> = {
    _owner: createOwner(),
    _len: 0,
    _list: list,
    _items: [],
    _map: wrappedMap,
    _mappings: [],
    _nodes: [],
    _key: keyFn,
    _rows: keyFn || options?.keyed === false ? [] : undefined,
    _indexes: indexes && options?.keyed !== false ? [] : undefined,
    _byIndex: options?.keyed === false,
    _fallback: options?.fallback
  };
  const node = computed(updateKeyedMap.bind(data as MapData<unknown, unknown>));
  // Untracked reads inside the internal owner resolve via _parentComputed; routing
  // them through node lets store-proxy lookups see pending writes (not stale _value).
  data._owner._parentComputed = node;
  node._config &= ~CONFIG_AUTO_DISPOSE;
  return accessor(node);
}

const pureOptions = { ownedWrite: true };
// Exception safety (#2903): a map callback can throw NotReadyError mid-pass
// (async read), and the computed re-runs the whole pass after settle. Every
// pass therefore STAGES its work — new rows are created into temp arrays and
// removals are deferred — and commits to `this` only after every mapper
// succeeded. An aborted pass disposes just the owners it created and leaves
// `_items`/`_mappings`/`_nodes`/`_rows`/`_indexes`/`_len` exactly as they
// were, so the retry diffs against uncorrupted state. Consequence of the
// strong-abort ordering: removed rows now dispose AFTER the pass's new rows
// are created (you cannot destroy state before knowing the pass will land).
function updateKeyedMap<Item, MappedItem>(this: MapData<Item, MappedItem>): any[] {
  const newItems = this._list() || [],
    newLen = newItems.length;
  (newItems as any)[$TRACK]; // top level tracking

  runWithOwner(this._owner, () => {
    let i: number,
      j: number,
      rows: Signal<Item>[] | undefined,
      indexes: Signal<number>[] | undefined,
      // Mappers write freshly-created row/index signals into the STAGE
      // arrays (`rows`/`indexes`), never into `this._rows`/`this._indexes`.
      mapper = this._rows
        ? this._byIndex
          ? () => {
              rows![j] = signal(newItems[j], pureOptions);
              return this._map(accessor(rows![j]), j);
            }
          : () => {
              rows![j] = signal(newItems[j], pureOptions);
              indexes && (indexes[j] = signal(j, pureOptions));
              return this._map(
                accessor(rows![j]),
                indexes ? accessor(indexes[j]) : (undefined as any)
              );
            }
        : this._indexes
          ? () => {
              const item = newItems[j];
              indexes![j] = signal(j, pureOptions);
              return this._map(item, accessor<number>(indexes![j]));
            }
          : () => {
              const item = newItems[j];
              return (this._map as (value: Item) => MappedItem)(item);
            };

    // fast path for empty arrays
    if (newLen === 0) {
      if (this._len !== 0) {
        this._owner.dispose(false);
        this._nodes = [];
        this._items = [];
        this._mappings = [];
        this._len = 0;
        this._rows && (this._rows = []);
        this._indexes && (this._indexes = []);
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
    }
    // fast path for new create
    else if (this._len === 0) {
      const mappings: MappedItem[] = new Array(newLen);
      const nodes: Root[] = new Array(newLen);
      rows = this._rows && new Array(newLen);
      indexes = this._indexes && new Array(newLen);

      try {
        for (j = 0; j < newLen; j++)
          mappings[j] = runWithOwner<MappedItem>((nodes[j] = createOwner()), mapper)!;
      } catch (err) {
        for (i = 0; i <= j!; i++) nodes[i]?.dispose();
        throw err;
      }

      // commit
      if (this._nodes[0]) this._nodes[0].dispose(); // previous fallback
      this._mappings = mappings;
      this._nodes = nodes;
      rows && (this._rows = rows);
      indexes && (this._indexes = indexes);
      this._items = newItems.slice(0);
      this._len = newLen;
    } else {
      let start: number,
        end: number,
        newEnd: number,
        item: Item,
        key: any,
        newIndices: Map<Item, number>,
        newIndicesNext: number[],
        removed: Root[] | undefined,
        created: Root[] | undefined;

      // skip common prefix
      for (
        start = 0, end = Math.min(this._len, newLen);
        start < end &&
        (this._items[start] === newItems[start] ||
          (this._rows && compare(this._key, this._items[start], newItems[start])));
        start++
      ) {
        if (this._rows) setSignal(this._rows[start], newItems[start]);
      }

      // skip common suffix — counted only; retained entries land in one pass
      // at commit instead of being staged and copied twice
      for (
        end = this._len - 1, newEnd = newLen - 1;
        end >= start &&
        newEnd >= start &&
        (this._items[end] === newItems[newEnd] ||
          (this._rows && compare(this._key, this._items[end], newItems[newEnd])));
        end--, newEnd--
      );

      // no structural change (every position matched in place at equal
      // length — the common post-reconcile shape): keep the same mapped
      // array identity so downstream consumers don't re-run at all
      if (start === newLen && this._len === newLen) {
        this._items = newItems.slice(0);
        return;
      }

      const dif = newLen - this._len;
      const temp: MappedItem[] = new Array(newLen);
      const tempNodes: Root[] = new Array(newLen);
      rows = this._rows ? new Array(newLen) : undefined;
      indexes = this._indexes ? new Array(newLen) : undefined;

      // 0) prepare a map of all indices in the changed window of newItems,
      // scanning backwards so we encounter them in natural order
      newIndices = new Map<Item, number>();
      newIndicesNext = new Array(newEnd + 1);
      for (j = newEnd; j >= start; j--) {
        item = newItems[j];
        key = this._key ? this._key(item) : item;
        i = newIndices.get(key)!;
        newIndicesNext[j] = i === undefined ? -1 : i;
        newIndices.set(key, j);
      }

      // 1) step through the old changed window and see if items can be found
      // in the new set; if so, stage them at their new positions; if not,
      // queue them for disposal at commit
      for (i = start; i <= end; i++) {
        item = this._items[i];
        key = this._key ? this._key(item) : item;
        j = newIndices.get(key)!;
        if (j !== undefined && j !== -1) {
          temp[j] = this._mappings[i];
          tempNodes[j] = this._nodes[i];
          rows && (rows[j] = this._rows![i]);
          indexes && (indexes[j] = this._indexes![i]);
          j = newIndicesNext[j];
          newIndices.set(key, j);
        } else (removed ??= []).push(this._nodes[i]);
      }

      // 2) create new rows into the temp arrays; an abort disposes only these
      try {
        for (j = start; j <= newEnd; j++) {
          if (tempNodes[j] !== undefined) continue;
          (created ??= []).push((tempNodes[j] = createOwner()));
          temp[j] = runWithOwner<MappedItem>(tempNodes[j], mapper)!;
        }
      } catch (err) {
        if (created) for (i = 0; i < created.length; i++) created[i].dispose();
        throw err;
      }

      // 3) commit: land the retained prefix and suffix plus the staged window
      // into the fresh arrays, swap them in (new identity for downstream
      // change propagation), then dispose exited rows
      for (i = 0; i < start; i++) {
        temp[i] = this._mappings[i];
        tempNodes[i] = this._nodes[i];
        rows && (rows[i] = this._rows![i]);
        indexes && (indexes[i] = this._indexes![i]);
      }
      for (j = start; j <= newEnd; j++) {
        if (rows) setSignal(rows[j], newItems[j]);
        if (indexes) setSignal(indexes[j], j);
      }
      for (j = newEnd + 1; j < newLen; j++) {
        temp[j] = this._mappings[j - dif];
        tempNodes[j] = this._nodes[j - dif];
        if (rows) {
          rows[j] = this._rows![j - dif];
          setSignal(rows[j], newItems[j]);
        }
        if (indexes) {
          indexes[j] = this._indexes![j - dif];
          if (dif !== 0) setSignal(indexes[j], j);
        }
      }
      this._mappings = temp;
      this._nodes = tempNodes;
      rows && (this._rows = rows);
      indexes && (this._indexes = indexes);
      this._len = newLen;
      // save a copy of the mapped items for the next update
      this._items = newItems.slice(0);
      if (removed) for (i = 0; i < removed.length; i++) removed[i].dispose();
    }
  });

  return this._mappings;
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

function compare<Item>(key: ((i: any) => any) | undefined, a: Item, b: Item): boolean {
  return key ? key(a) === key(b) : true;
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

interface MapData<Item = any, MappedItem = any> {
  _owner: Root;
  _len: number;
  _list: Accessor<Maybe<readonly Item[]>>;
  _items: Item[];
  _mappings: MappedItem[];
  _nodes: Root[];
  _map: (value: any, index: any) => any;
  _key: ((i: any) => any) | undefined;
  _rows?: Signal<Item>[];
  _indexes?: Signal<number>[];
  _byIndex: boolean;
  _fallback?: Accessor<any>;
}
