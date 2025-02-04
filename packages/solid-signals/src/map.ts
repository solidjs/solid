import { Computation, compute, Owner } from "./core/index.js";
import { runWithOwner } from "./signals.js";
import type { Accessor } from "./signals.js";
import { $TRACK } from "./store/index.js";

export type Maybe<T> = T | void | null | undefined | false;

/**
 * Reactively transforms an array with a callback function - underlying helper for the `<For>` control flow
 *
 * similar to `Array.prototype.map`, but gets the value and index as accessors, transforms only values that changed and returns an accessor and reactively tracks changes to the list.
 *
 * @description https://docs.solidjs.com/reference/reactive-utilities/map-array
 */
export function mapArray<Item, MappedItem>(
  list: Accessor<Maybe<readonly Item[]>>,
  map: (value: Accessor<Item>, index: Accessor<number>) => MappedItem,
  options?: { keyed?: boolean | ((item: Item) => any); fallback?: Accessor<any> }
): Accessor<MappedItem[]> {
  const keyFn = typeof options?.keyed === "function" ? options.keyed : undefined;
  return updateKeyedMap.bind({
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
    _fallback: options?.fallback
  });
}

function updateKeyedMap<Item, MappedItem>(this: MapData<Item, MappedItem>): any[] {
  const newItems = this._list() || [],
    newLen = newItems.length;
  (newItems as any)[$TRACK]; // top level tracking

  runWithOwner(this._owner, () => {
    let i: number,
      j: number,
      mapper = this._rows
        ? () => {
            this._rows![j] = new Computation(newItems[j], null);
            this._indexes && (this._indexes![j] = new Computation(j, null));
            return this._map(
              Computation.prototype.read.bind(this._rows![j]),
              this._indexes
                ? Computation.prototype.read.bind(this._indexes![j])
                : (undefined as any)
            );
          }
        : this._indexes
          ? () => {
              const item = newItems[j];
              this._indexes![j] = new Computation(j, null);
              return this._map(() => item, Computation.prototype.read.bind(this._indexes![j]));
            }
          : () => {
              const item = newItems[j];
              return (this._map as (value: () => Item) => MappedItem)(() => item);
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
        // create fallback
        this._mappings[0] = compute<MappedItem>(
          (this._nodes[0] = new Owner()),
          this._fallback,
          null
        );
      }
    }
    // fast path for new create
    else if (this._len === 0) {
      // dispose previous fallback
      if (this._nodes[0]) this._nodes[0].dispose();
      this._mappings = new Array(newLen);

      for (j = 0; j < newLen; j++) {
        this._items[j] = newItems[j];
        this._mappings[j] = compute<MappedItem>((this._nodes[j] = new Owner()), mapper, null);
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
        tempRows: Computation<Item>[] | undefined = this._rows ? new Array(newLen) : undefined,
        tempIndexes: Computation<number>[] | undefined = this._indexes
          ? new Array(newLen)
          : undefined;

      // skip common prefix
      for (
        start = 0, end = Math.min(this._len, newLen);
        start < end &&
        (this._items[start] === newItems[start] ||
          (this._rows && compare(this._key, this._items[start], newItems[start])));
        start++
      ) {
        if (this._rows) this._rows[start].write(newItems[start]);
      }

      // common suffix
      for (
        end = this._len - 1, newEnd = newLen - 1;
        end >= start &&
        newEnd >= start &&
        (this._items[end] === newItems[newEnd] ||
          (this._rows && compare(this._key, this._items[end], newItems[newEnd])));
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
          this._mappings[j] = compute<MappedItem>((this._nodes[j] = new Owner()), mapper, null);
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

/**
 * Reactively repeats a callback function the count provided - underlying helper for the `<Repeat>` control flow
 *
 * @description https://docs.solidjs.com/reference/reactive-utilities/repeat
 */
export function repeat(
  count: Accessor<number>,
  map: (index: number) => any,
  options?: {
    fallback?: Accessor<any>;
  }
): Accessor<any[]> {
  return updateRepeat.bind({
    _owner: new Owner(),
    _len: 0,
    _count: count,
    _map: map,
    _nodes: [],
    _mappings: [],
    _fallback: options?.fallback
  });
}

function updateRepeat<MappedItem>(this: RepeatData<MappedItem>): any[] {
  const newLen = this._count();
  runWithOwner(this._owner, () => {
    if (newLen === 0) {
      if (this._len !== 0) {
        this._owner.dispose(false);
        this._nodes = [];
        this._mappings = [];
        this._len = 0;
      }
      if (this._fallback && !this._mappings[0]) {
        // create fallback
        this._mappings[0] = compute<MappedItem>(
          (this._nodes[0] = new Owner()),
          this._fallback,
          null
        );
      }
    } else {
      // remove fallback
      if (this._len === 0 && this._nodes[0]) this._nodes[0].dispose();

      for (let i = this._len; i < newLen; i++) {
        this._mappings[i] = compute<MappedItem>(
          (this._nodes[i] = new Owner()),
          () => this._map(i),
          null
        );
      }
      for (let i = newLen; i < this._len; i++) this._nodes[i].dispose();
      this._mappings = this._mappings.slice(0, newLen);
      this._len = newLen;
    }
  });
  return this._mappings;
}

function compare<Item>(key: ((i: any) => any) | undefined, a: Item, b: Item): boolean {
  return key ? key(a) === key(b) : true;
}

interface RepeatData<MappedItem = any> {
  _owner: Owner;
  _len: number;
  _count: Accessor<number>;
  _map: (index: number) => MappedItem;
  _mappings: MappedItem[];
  _nodes: Owner[];
  _fallback?: Accessor<any>;
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
  _fallback?: Accessor<any>;
}
