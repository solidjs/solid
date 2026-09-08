/**
 * REFERENCE mapArray — the pre-engine implementation, frozen as the ORACLE
 * for the unified For engine's differential tests. Test-only; never shipped.
 * Written against solid-js's PUBLIC API (createMemo/createSignal/createOwner/
 * runWithOwner/$TRACK) so it runs on the same reactive core as the engine
 * under test. Semantics are mapArray's as of 2026-09-07 (before mapArray
 * became the engine's array output).
 */
import { createMemo, createOwner, createSignal, runWithOwner, $TRACK } from "solid-js";
type Accessor<T> = () => T;
export type Maybe<T> = T | void | null | undefined | false;
const pureOptions = { ownedWrite: true };

export function referenceMapArray<Item, MappedItem>(
  list: Accessor<Maybe<readonly Item[]>>,
  map:
    | ((value: Item, index: Accessor<number>) => MappedItem)
    | ((value: Accessor<Item>, index: number) => MappedItem)
    | ((value: Accessor<Item>, index: Accessor<number>) => MappedItem),
  options?: {
    keyed?: boolean | ((item: Item) => any);
    fallback?: Accessor<any>;
    name?: string;
    lazy?: boolean;
  }
): Accessor<MappedItem[]> {
  const keyFn = typeof options?.keyed === "function" ? options.keyed : undefined;
  const indexes = map.length > 1;
  const wrappedMap = map;
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
  return createMemo(updateKeyedMap.bind(data as MapData<unknown, unknown>));
}

function updateKeyedMap<Item, MappedItem>(this: MapData<Item, MappedItem>): any[] {
  const newItems = this._list() || [],
    newLen = newItems.length;
  (newItems as any)[$TRACK]; // top level tracking

  runWithOwner(this._owner, () => {
    let i: number,
      j: number,
      rows: any[] | undefined,
      indexes: any[] | undefined,
      // Mappers write freshly-created row/index signals into the STAGE
      // arrays (`rows`/`indexes`), never into `this._rows`/`this._indexes`.
      mapper = this._rows
        ? this._byIndex
          ? () => {
              rows![j] = createSignal(newItems[j], pureOptions);
              return this._map(rows![j][0], j);
            }
          : () => {
              rows![j] = createSignal(newItems[j], pureOptions);
              indexes && (indexes[j] = createSignal(j, pureOptions));
              return this._map(rows![j][0], indexes ? indexes[j][0] : (undefined as any));
            }
        : this._indexes
          ? () => {
              const item = newItems[j];
              indexes![j] = createSignal(j, pureOptions);
              return this._map(item, indexes![j][0]);
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
          (this._nodes[0] = createOwner() as any),
          this._fallback
        );
      }
    }
    // fast path for new create
    else if (this._len === 0) {
      const mappings: MappedItem[] = new Array(newLen);
      const nodes: any[] = new Array(newLen);
      rows = this._rows && new Array(newLen);
      indexes = this._indexes && new Array(newLen);

      try {
        for (j = 0; j < newLen; j++)
          mappings[j] = runWithOwner<MappedItem>((nodes[j] = createOwner() as any), mapper)!;
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
        removed: any[] | undefined,
        created: any[] | undefined;

      // skip common prefix
      for (
        start = 0, end = Math.min(this._len, newLen);
        start < end &&
        (this._items[start] === newItems[start] ||
          (this._rows && compare(this._key, this._items[start], newItems[start])));
        start++
      ) {
        if (this._rows) this._rows[start][1](newItems[start]);
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
      const tempNodes: any[] = new Array(newLen);
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
          (created ??= []).push((tempNodes[j] = createOwner() as any));
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
        if (rows) rows[j][1](newItems[j]);
        if (indexes) indexes[j][1](j);
      }
      for (j = newEnd + 1; j < newLen; j++) {
        temp[j] = this._mappings[j - dif];
        tempNodes[j] = this._nodes[j - dif];
        if (rows) {
          rows[j] = this._rows![j - dif];
          rows[j][1](newItems[j]);
        }
        if (indexes) {
          indexes[j] = this._indexes![j - dif];
          if (dif !== 0) indexes[j][1](j);
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
function compare<Item>(key: ((i: any) => any) | undefined, a: Item, b: Item): boolean {
  return key ? key(a) === key(b) : true;
}

interface MapData<Item = any, MappedItem = any> {
  _owner: any;
  _len: number;
  _list: Accessor<Maybe<readonly Item[]>>;
  _items: Item[];
  _mappings: MappedItem[];
  _nodes: any[];
  _map: (value: any, index: any) => any;
  _key: ((i: any) => any) | undefined;
  _rows?: any[];
  _indexes?: any[];
  _byIndex: boolean;
  _fallback?: Accessor<any>;
}
