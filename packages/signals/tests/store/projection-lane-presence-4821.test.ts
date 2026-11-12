// #4821: a keyed projection derived in a guess's lane (a rename still out)
// while another guess (a close) is declined. The projection's slots carry the
// lane's values; an untracked read in a lane pass (mapArray's `slice(0)`, its
// key/presence probes) read presence and keys from the committed frame while
// the slot's value read the lane, so the copy had a hole where `rows[2]`
// read row 4. Presence, keys and values of one slot answer from one frame.
import { expect, test } from "vitest";
import {
  action,
  createMemo,
  createOptimistic,
  createProjection,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  mapArray,
  untrack
} from "../../src/index.js";

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

for (const withRename of [true, false])
  test(`#4821 mapArray over a keyed projection after a declined removal (rename out: ${withRename})`, async () => {
    const seen: string[] = [];
    const shape: string[] = [];
    let close!: (id: number) => any, decline!: () => void, rename!: (id: number) => any;
    const dispose = createRoot(dispose => {
      const [base] = createSignal([{ id: 1 }, { id: 3 }, { id: 4 }]);
      const [renT] = createSignal<any[]>(() => []);
      const [ren, guessRen] = createOptimistic(() => renT());
      const [closingT] = createSignal<number[]>(() => []);
      const [closing, guessClosing] = createOptimistic(() => closingT());
      const src = createMemo(() =>
        base()
          .filter(i => !closing().includes(i.id))
          .map(i => ({
            id: i.id,
            title: ren()
              .filter((r: any) => r.id === i.id)
              .reduce((_: string, r: any) => r.title, `t${i.id}`)
          }))
      );
      const rows: any = createProjection(() => src() as any, [] as any, { key: "id" } as any);
      const mapped = mapArray(
        () => rows,
        (r: any) => () => (typeof r === "function" ? r() : r)?.id
      );
      createRenderEffect(
        () =>
          mapped()
            .map((f: any) => String(f()))
            .join(","),
        v => {
          seen.push(v);
        }
      );
      // A second reader of the projection, by length and index.
      createRenderEffect(
        () => Array.from({ length: rows.length }, (_, i) => rows[i]?.id).join(","),
        () => {}
      );
      // A lane pass's untracked view of the list: length, keys, presence and
      // values agree.
      createRenderEffect(
        () => {
          const n = rows.length;
          return untrack(() => {
            const idx = Array.from({ length: n }, (_, i) => i);
            return [
              n,
              Object.keys(rows).join(""),
              idx.map(i => (i in rows ? 1 : 0)).join(""),
              idx.map(i => rows[i]?.id).join(""),
              rows
                .slice(0)
                .map((r: any) => r?.id)
                .join("")
            ].join("|");
          });
        },
        v => {
          shape.push(v);
        }
      );
      rename = action(function* (id: number) {
        guessRen((rs: any[]) => [...rs, { id, title: "new" }]);
        yield new Promise(() => {});
      });
      close = action(function* (id: number) {
        guessClosing((cs: number[]) => [...cs, id]);
        try {
          yield new Promise((_, rej) => (decline = () => rej(new Error("declined"))));
        } catch {}
      });
      return dispose;
    });
    await tick();
    if (withRename) {
      rename(3);
      await tick();
    }
    close(1);
    await tick();
    expect(seen.at(-1)).toBe("3,4");
    decline();
    await tick();
    expect(seen.at(-1)).toBe("1,3,4");
    expect(shape.at(-1)).toBe("3|012|111|134|134");
    dispose();
  });
