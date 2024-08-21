import { Computation, compute } from './core';
import { Owner } from './owner';
import { runWithOwner } from './signals';
import type { Accessor } from './signals';

export type Maybe<T> = T | void | null | undefined | false;

/**
 * Reactive map helper that caches each list item by reference to reduce unnecessary mapping on
 * updates.
 *
 * @see {@link https://github.com/solidjs/x-reactivity#maparray}
 */
export function mapArray<Item, MappedItem>(
  list: Accessor<Maybe<readonly Item[]>>,
  map: (value: Accessor<Item>, index: Accessor<number>) => MappedItem,
  options?: { keyed?: boolean | ((item: Item) => any); name?: string },
): Accessor<MappedItem[]> {
  const keyFn =
    typeof options?.keyed === 'function' ? options.keyed : undefined;
  return Computation.prototype.read.bind(
    new Computation<MappedItem[]>(
      [],
      updateKeyedMap.bind({
        _owner: new Owner(),
        _len: 0,
        _list: list,
        _items: [],
        _map: map,
        _mappings: [],
        _nodes: [],
        _key: keyFn,
        _rows: keyFn || options?.keyed === false ? [] : undefined,
        _indexes: map.length > 1 ? [] : undefined,
      }),
      options,
    ),
  );
}

function updateKeyedMap<Item, MappedItem>(
  this: MapData<Item, MappedItem>,
): any[] {
  const newItems = this._list() || [];

  runWithOwner(this._owner, () => {
    let newLen = newItems.length,
      i: number,
      j: number,
      mapper = this._rows
        ? () => {
            this._rows![j] = new Computation(newItems[j], null);
            this._indexes![j] = new Computation(j, null);
            return this._map(
              Computation.prototype.read.bind(this._rows![j]),
              Computation.prototype.read.bind(this._indexes![j]),
            );
          }
        : this._indexes
          ? () => {
              const item = newItems[j];
              this._indexes![j] = new Computation(j, null);
              return this._map(
                () => item,
                Computation.prototype.read.bind(this._indexes![j]),
              );
            }
          : () => {
              const item = newItems[j];
              return (this._map as (value: () => Item) => MappedItem)(
                () => item,
              );
          }

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
    }
    // fast path for new create
    else if (this._len === 0) {
      this._mappings = new Array(newLen);

      for (j = 0; j < newLen; j++) {
        this._items[j] = newItems[j];
        this._mappings[j] = compute<MappedItem>(
          (this._nodes[j] = new Owner()),
          mapper,
          null,
        );
      }

      this._len = newLen;
    } else {
      let start: number,
        end: number,
        newEnd: number,
        item: Item,
        key: any,
        newIndices: Map<Item, number>,
        newIndicesNext: number[],
        temp: MappedItem[] = new Array(newLen),
        tempNodes: Owner[] = new Array(newLen),
        tempRows: Computation<Item>[] | undefined = this._rows
          ? new Array(newLen)
          : undefined,
        tempIndexes: Computation<number>[] | undefined = this._indexes
          ? new Array(newLen)
          : undefined;

      // skip common prefix
      for (
        start = 0, end = Math.min(this._len, newLen);
        start < end &&
        (this._items[start] === newItems[start] ||
          (this._rows &&
            compare(this._key, this._items[start], newItems[start])));
        start++
      ) {
        if (this._rows) this._rows[start].write(newItems[start]);
      }

      // common suffix
      for (
        end = this._len - 1, newEnd = newLen - 1;
        end >= start &&
        newEnd >= start &&
        (this._items[end] === newItems[newEnd] || (this._rows && compare(this._key, this._items[end], newItems[newEnd])));
        end--, newEnd--
      ) {
        temp[newEnd] = this._mappings[end];
        tempNodes[newEnd] = this._nodes[end];
        tempRows && (tempRows[newEnd] = this._rows![end]);
        tempIndexes && (tempIndexes[newEnd] = this._indexes![end]);
      }

      // 0) prepare a map of all indices in newItems, scanning backwards so we encounter them in natural order
      newIndices = new Map<Item, number>();
      newIndicesNext = new Array(newEnd + 1);
      for (j = newEnd; j >= start; j--) {
        item = newItems[j];
        key = this._key ? this._key(item) : item;
        i = newIndices.get(key)!;
        newIndicesNext[j] = i === undefined ? -1 : i;
        newIndices.set(key, j);
      }

      // 1) step through all old items and see if they can be found in the new set; if so, save them in a temp array and mark them moved; if not, exit them
      for (i = start; i <= end; i++) {
        item = this._items[i];
        key = this._key ? this._key(item) : item;
        j = newIndices.get(key)!;
        if (j !== undefined && j !== -1) {
          temp[j] = this._mappings[i];
          tempNodes[j] = this._nodes[i];
          tempRows && (tempRows[j] = this._rows![i]);
          tempIndexes && (tempIndexes[j] = this._indexes![i]);
          j = newIndicesNext[j];
          newIndices.set(key, j);
        } else this._nodes[i].dispose();
      }

      // 2) set all the new values, pulling from the temp array if copied, otherwise entering the new value
      for (j = start; j < newLen; j++) {
        if (j in temp) {
          this._mappings[j] = temp[j];
          this._nodes[j] = tempNodes[j];
          if (tempRows) {
            this._rows![j] = tempRows[j];
            this._rows![j].write(newItems[j]);
          }
          if (tempIndexes) {
            this._indexes![j] = tempIndexes[j];
            this._indexes![j].write(j);
          }
        } else {
          this._mappings[j] = compute<MappedItem>(
            (this._nodes[j] = new Owner()),
            mapper,
            null,
          );
        }
      }

      // 3) in case the new set is shorter than the old, set the length of the mapped array
      this._mappings = this._mappings.slice(0, (this._len = newLen));

      // 4) save a copy of the mapped items for the next update
      this._items = newItems.slice(0);
    }
  });

  return this._mappings;
}

function compare<Item>(
  key: ((i: any) => any) | undefined,
  a: Item,
  b: Item,
): boolean {
  return key ? key(a) === key(b) : true;
}

interface MapData<Item = any, MappedItem = any> {
  _owner: Owner;
  _len: number;
  _list: Accessor<Maybe<readonly Item[]>>;
  _items: Item[];
  _mappings: MappedItem[];
  _nodes: Owner[];
  _map: (value: Accessor<any>, index: Accessor<number>) => any;
  _key: ((i: any) => any) | undefined;
  _rows?: Computation<Item>[];
  _indexes?: Computation<number>[];
}
