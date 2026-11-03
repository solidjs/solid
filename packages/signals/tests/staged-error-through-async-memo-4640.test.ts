/**
 * #4640 review: a plain memo `m` over an async memo `am` over an async source
 * `s`. A write (or an action's write) re-asks `s` and a sibling flight on the
 * same write keeps the change held after `s` rejects.
 *
 * `m` reads the staging through `am` (D-41: "a derivation that reads a
 * staged error throws it"), so its verdict stays pending until the commit
 * (F-9, D-22, D-23) and an untracked `latest(m)` in that window throws the
 * staged error rather than returning the old value that the commit then
 * replaces (#4456). The commit shows the error once: an effect's error arm
 * over `m` fires a single time.
 *
 * Narrowing the staging to readers of a staging (#4640) must not drop the
 * async memo from the marking: unmarked, `m` reported final and `latest(m)`
 * returned "A!" in the window.
 */
import { expect, it } from "vitest";
import {
  action,
  createEffect,
  createErrorBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  latest
} from "../src/index.js";

const tick = async () => {
  for (let k = 0; k < 4; k++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

it.each(["write", "action"] as const)(
  "a memo over an async memo over a rejected source stays pending until the commit (%s)",
  async how => {
    const asks: { res: (v: string) => void; rej: (e: unknown) => void }[] = [];
    const keeps: ((v: string) => void)[] = [];
    const frames: string[] = [];
    const errors: string[] = [];
    const scr = { m: "-", p: "-" };
    const [sel, setSel] = createSignal(1);
    let m!: () => string;
    createRoot(() => {
      const s = createMemo(() => {
        sel();
        return new Promise<string>((res, rej) => asks.push({ res, rej }));
      });
      const am = createMemo(async () => {
        const v = s();
        await 0;
        return v;
      });
      m = createMemo(() => am() + "!");
      const keep = createMemo(() => {
        sel();
        return new Promise<string>(res => keeps.push(res));
      });
      const eb = <T>(f: () => T) => createErrorBoundary(f, () => "ERR");
      const vm = eb(() => m());
      const vp = eb(() => String(isPending(m)));
      const vk = eb(() => keep());
      createRenderEffect(
        () => vm(),
        v => void (scr.m = v)
      );
      createRenderEffect(
        () => vp(),
        v => void (scr.p = v)
      );
      createRenderEffect(
        () => vk(),
        () => {}
      );
      createEffect(m, {
        effect: () => {},
        error: e => void errors.push((e as Error).message)
      });
    });
    const frame = (l: string) => frames.push(`${l}[${scr.m} pending=${scr.p}]`);

    await tick();
    asks.shift()!.res("A");
    keeps.shift()!("k");
    await tick();
    frame("shown");

    let release: (() => void) | undefined;
    if (how === "action")
      action(function* () {
        setSel(2);
        yield new Promise<void>(r => (release = r));
      })();
    else setSel(2);
    flush();
    await tick();
    frame("held");

    asks.shift()!.rej(new Error("boom"));
    await tick();
    frame("rejected");
    let mid: string;
    try {
      mid = latest(m);
    } catch (e) {
      mid = "throws " + ((e as any)?.cause?.message ?? (e as Error).message);
    }

    keeps.shift()!("k2");
    await tick();
    if (release) {
      release();
      await tick();
    }
    frame("committed");

    expect(frames).toEqual([
      "shown[A! pending=false]",
      "held[A! pending=true]",
      "rejected[A! pending=true]",
      "committed[ERR pending=false]"
    ]);
    expect(mid).toBe("throws boom");
    expect(errors).toEqual(["boom"]);
  }
);
