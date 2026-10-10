// A render effect or memo that reads a held value plainly beside isPending
// of it shows the verdict now, whichever read comes first in the pass; the
// fresh value reveals at the commit (D-23, F-6). Both an action's hold and a
// hold on async downstream of the write.
import { expect, it } from "vitest";
import {
  action,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending
} from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  flush();
};

for (const reader of ["effect", "memo"] as const)
  for (const order of ["probe first", "plain first"] as const)
    for (const how of ["action", "async"] as const)
      it(`${reader} ${how}: ${order}: the spinner shows now`, async () => {
        const [x, setX] = createSignal(0);
        const log: string[] = [];
        const gates: (() => void)[] = [];
        createRoot(() => {
          const slow = createMemo(async () => {
            const v = x();
            if (v && how === "async") await new Promise<void>(r => gates.push(r));
            return v;
          });
          createRenderEffect(slow, () => {});
          const fn = () =>
            order === "probe first"
              ? `${isPending(x) ? "…" : ""}${x()}`
              : `${x()}${isPending(x) ? "…" : ""}`;
          if (reader === "memo") {
            const m = createMemo(fn);
            createRenderEffect(m, v => void log.push(v));
          } else createRenderEffect(fn, v => void log.push(v));
        });
        flush();
        await tick();
        if (how === "action")
          action(function* () {
            setX(1);
            yield new Promise<void>(r => gates.push(r));
          })();
        else setX(1);
        flush();
        await tick();
        const mid = log.at(-1);
        gates.forEach(g => g());
        await tick();
        expect([mid, log.at(-1)]).toEqual([order === "probe first" ? "…0" : "0…", "1"]);
      });
