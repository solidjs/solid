// Store enumeration fence (#3664).
//
// A computation that enumerates a store object — `Object.keys(row)`,
// `{ ...row }`, `for...in`, `Object.entries`, `JSON.stringify` — takes the
// `ownKeys` trap once and the `getOwnPropertyDescriptor` trap once per key.
// Its subscription cost must be FLAT in the key count: `ownKeys` subscribes
// the reader to the object's one key-set node, which bumps on every
// membership change, so a presence node per key would only duplicate it.
// rc.9 did exactly that (the descriptor trap's presence read, 765a65665,
// meant for a lone descriptor inspection): one signal + node extension +
// closure per key per enumerated object, ~640 B each — a 30-field row's
// enumerator went from 2 KB to 20 KB and creation time rose ~1.5x.
//
// Each bench mounts one memo + render effect per row over ROWS rows of
// FIELDS fields (the "row + derived fields" projection shape), then tears it
// down. `leafRead` is the flat reference: a reader touching two fields,
// whose cost never depended on FIELDS. If an enumerator bench moves away
// from `leafRead` by anything like FIELDS x, the per-key subscription is
// back. The structural pin (zero presence nodes on the target) lives in
// enumerator-presence-nodes.test.ts; this file makes the cost visible to
// CodSpeed.
import { bench } from "vitest";
import { createMemo, createRenderEffect, createRoot, createStore, flush } from "../../src/index.js";

const ROWS = 1_000;
const FIELDS = 30;
const filter = new RegExp(process.env.FILTER || ".+");

type Row = Record<string, number>;

function buildRows(): Row[] {
  const rows = new Array<Row>(ROWS);
  for (let i = 0; i < ROWS; i++) {
    const r: Row = {};
    for (let f = 0; f < FIELDS; f++) r[`f${f}`] = i + f;
    rows[i] = r;
  }
  return rows;
}

function runBench(name: string, read: (row: Row) => number) {
  if (!filter.test(name)) return;
  bench(`enumerate:${name} ${ROWS} rows x ${FIELDS} fields`, () => {
    const [rows] = createStore<Row[]>(buildRows());
    let sum = 0;
    createRoot(dispose => {
      for (let i = 0; i < ROWS; i++) {
        const m = createMemo(() => read(rows[i]));
        createRenderEffect(
          () => m(),
          v => {
            sum += v;
          }
        );
      }
      flush();
      dispose();
    });
    if (sum === 0) throw new Error("readers did not run");
  });
}

// Flat reference: two leaf reads, cost independent of FIELDS.
runBench("leafRead", row => row.f0 + row.f1);

// `Object.keys`: ownKeys + one descriptor per key (enumerability check).
runBench("Object.keys", row => Object.keys(row).length);

// `for...in`: the same trap sequence as Object.keys, via the iterator.
runBench("for...in", row => {
  let n = 0;
  for (const _ in row) n++;
  return n;
});

// Spread: ownKeys + per key a descriptor AND a value read (one value node
// per key is legitimate — the reader consumes every value).
runBench("spread", row => ({ ...row }).f0 + 1);
