/**
 * The first draft write to a plain array clones it by `slice()`.
 *
 * `cloneRaw` grades containers by their prototype; a plain array is never
 * grade 2 (Array.prototype, non-enumerable `length`), so every array write
 * took the descriptor path: one descriptor object per element, then
 * `defineProperties`. A push into a 10k-row store cost ~10 ms. Plain arrays
 * with no accessors and no named keys now slice; anything else keeps the
 * descriptor path, which these tests pin as unchanged.
 */
import { describe, expect, it } from "vitest";
import { createRoot, createStore, createRenderEffect, flush } from "../../src/index.js";

describe("array clone on first draft write", () => {
  it("writes, pushes and splices a plain array", () => {
    const [s, set] = createStore({ rows: [{ id: 1 }, { id: 2 }, { id: 3 }] });
    let seen: number[] = [];
    createRoot(() =>
      createRenderEffect(
        () => s.rows.map(r => r.id),
        v => {
          seen = v;
        }
      )
    );
    flush();
    set(d => {
      d.rows.push({ id: 4 });
    });
    flush();
    expect(seen).toEqual([1, 2, 3, 4]);
    set(d => {
      d.rows.splice(1, 1);
      d.rows[0] = { id: 9 };
    });
    flush();
    expect(seen).toEqual([9, 3, 4]);
  });

  it("keeps holes", () => {
    // eslint-disable-next-line no-sparse-arrays
    const [s, set] = createStore({ list: [1, , 3] as number[] });
    set(d => {
      d.list[3] = 4;
    });
    flush();
    expect(1 in s.list).toBe(false);
    expect(s.list.length).toBe(4);
    expect(s.list[3]).toBe(4);
  });

  it("keeps named keys on an array", () => {
    const list: any = [1, 2];
    list.total = 2;
    const [s, set] = createStore({ list });
    set(d => {
      d.list.push(3);
    });
    flush();
    expect((s.list as any).total).toBe(2);
    expect([...s.list]).toEqual([1, 2, 3]);
  });

  it("keeps accessors on an array", () => {
    const list: any = [1, 2];
    Object.defineProperty(list, "0", { get: () => 10, enumerable: true, configurable: true });
    const [s, set] = createStore({ list });
    set(d => {
      d.list.push(3);
    });
    flush();
    expect(s.list[0]).toBe(10);
    expect(s.list.length).toBe(3);
  });
});
