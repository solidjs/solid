/**
 * #4825: two actions guess one slot of an optimistic store, one after the
 * other. The first action's write has landed and it waits on a `refresh()`
 * of another source; its truth pass staged the heading's branch (no guess:
 * the detail title) in that hold. The second action guesses the slot during
 * the wait: the branch's condition re-derives as the new guess's lane work,
 * to the value the screen already shows. Its readers derived from the
 * hold's staging, which the lane voided, so they re-derive too; otherwise
 * the hold's landing applied the stale branch and the second guess vanished
 * while its write was still out (F-11: the guess is the displayed value until
 * its hold commits; D-33: same-slot guesses entangle).
 *
 * Two shapes of the compiled ternary: the branch mounted by the condition's
 * reader (`insert` of a `cond ? <span/> : <span/>`), and one binding reading
 * the branch a memo selects.
 */
import { describe, expect, test } from "vitest";
import {
  action,
  createMemo,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  flush,
  refresh
} from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

function run(shape: "mounted" | "selected") {
  const asks: { key: string; res: (v: any) => void }[] = [];
  const ask = (key: string) => new Promise<any>(res => asks.push({ key, res }));
  const answer = async (key: string, v: any) => {
    const i = asks.findIndex(a => a.key === key);
    if (i < 0) throw new Error(`no ask ${key}`);
    asks.splice(i, 1)[0].res(v);
    await tick();
  };
  let rename!: (t: string) => unknown;
  let count = "",
    heading = "";
  createRoot(() => {
    const detail = createMemo(() => ask("detail"));
    const [renaming, setRenaming] = createOptimisticStore<Record<number, string>>(d => {
      for (const k of Object.keys(d)) delete d[k as any];
    }, {});
    const list = createMemo(() => ask("list"));
    rename = action(function* (t: string) {
      setRenaming(d => {
        d[2] = t;
      });
      yield ask(`rename:${t}`);
      refresh(list);
      refresh(detail);
    });
    createRenderEffect(
      () => (list() as number[]).length,
      n => {
        count = String(n);
      }
    );
    const guessed = createMemo(() => (renaming[2] ?? "") !== "");
    if (shape === "mounted")
      createRenderEffect(
        () => {
          if (guessed())
            createRenderEffect(
              () => renaming[2],
              v => {
                heading = v;
              }
            );
          else
            createRenderEffect(
              () => (detail() as { title: string }).title,
              v => {
                heading = v;
              }
            );
        },
        () => {}
      );
    else {
      const branch = createMemo(() =>
        guessed() ? () => renaming[2] : () => (detail() as { title: string }).title
      );
      createRenderEffect(
        () => branch()(),
        v => {
          heading = v;
        }
      );
    }
  });
  return { answer, rename: (t: string) => rename(t), screen: () => `${count} ${heading}` };
}

describe("a second guess on one slot holds until its own action ends (#4825)", () => {
  for (const shape of ["mounted", "selected"] as const)
    test(shape, async () => {
      const t = run(shape);
      await tick();
      await t.answer("detail", { title: "Old" });
      await t.answer("list", [1]);
      expect(t.screen()).toBe("1 Old");
      t.rename("Bravo");
      await tick();
      expect(t.screen()).toBe("1 Bravo");
      await t.answer("rename:Bravo", {});
      expect(t.screen()).toBe("1 Bravo");
      await t.answer("detail", { title: "Bravo" });
      expect(t.screen()).toBe("1 Bravo");
      t.rename("Delta");
      await tick();
      expect(t.screen()).toBe("1 Delta");
      // Bravo's refresh answers and its action ends: Delta's write is out.
      await t.answer("list", [1]);
      expect(t.screen()).toBe("1 Delta");
      await t.answer("rename:Delta", {});
      expect(t.screen()).toBe("1 Delta");
      await t.answer("list", [1]);
      await t.answer("detail", { title: "Delta" });
      expect(t.screen()).toBe("1 Delta");
    });
});
