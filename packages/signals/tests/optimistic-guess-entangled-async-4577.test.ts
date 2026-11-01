import { expect, test } from "vitest";
import {
  action,
  createErrorBoundary,
  createMemo,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  refresh
} from "../src/index.js";
const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};
test("#4577 with a second async change entangled mid-hold: the screen settles as one (F-1, D-9)", async () => {
  const asks: { key: string; res: (v: any) => void }[] = [];
  const ask = (key: string) => new Promise<any>(res => asks.push({ key, res }));
  const settle = async (pre: string, v: any) => {
    asks
      .splice(
        asks.findIndex(a => a.key.startsWith(pre)),
        1
      )[0]
      .res(v);
    await tick();
  };
  const frames: string[] = [];
  let f = "",
    l = "",
    o = "";
  let q = false;
  const snap = () => {
    if (!q) {
      q = true;
      queueMicrotask(() => {
        q = false;
        frames.push(`${f}: ${l} | ${o}`);
      });
    }
  };
  let setFilter!: (v: string) => void,
    setTag!: (v: string) => void,
    closeOne!: (id: number) => unknown,
    dispose!: () => void;
  createRoot(d => {
    dispose = d;
    const [filter, sf] = createSignal("open");
    setFilter = sf;
    const [tag, st] = createSignal("t0");
    setTag = st;
    const [issues, set] = createOptimisticStore<{ id: number }[]>(
      () => ask(`issues:${filter()}`),
      [],
      { key: "id" }
    );
    const other = createMemo(() => (issues.length, ask(`other:${filter()}:${tag()}`)));
    const tagv = createMemo(() => ask(`tag:${tag()}`));
    closeOne = action(function* (id: number) {
      set(xs => {
        const i = xs.findIndex(t => t.id === id);
        if (i >= 0) xs.splice(i, 1);
      });
      yield ask(`close:${id}`);
      refresh(issues);
    });
    const list = createMemo(() => issues.map(r => `[#${r.id}]`).join(""));
    createRenderEffect(filter, v => {
      f = v;
      snap();
    });
    createRenderEffect(list, v => {
      l = v;
      snap();
    });
    createRenderEffect(
      createErrorBoundary(
        () => other(),
        () => "ERR"
      ) as any,
      (v: any) => {
        o = String(v);
        snap();
      }
    );
    createRenderEffect(
      createErrorBoundary(
        () => String(tagv()),
        () => "ERR"
      ) as any,
      () => {}
    );
  });
  await tick();
  await settle("issues:open", [{ id: 1 }, { id: 3 }, { id: 4 }]);
  await settle("other:open", "O-open");
  await settle("tag:t0", "t0");
  setFilter("closed");
  await tick();
  closeOne(1);
  await tick();
  setTag("t1");
  await tick();
  await settle("issues:closed", [{ id: 1 }, { id: 2 }]);
  await settle("other:closed", "O-closed");
  await settle("close:1", {});
  await settle("issues:closed", [{ id: 2 }]);
  for (let k = 0; k < 20 && asks.length; k++) {
    const a = asks.shift()!;
    const p = a.key.split(":");
    a.res(
      p[0] === "other" ? `O-${p[1]}` : p[0] === "tag" ? p[1] : p[0] === "issues" ? [{ id: 2 }] : {}
    );
    await tick();
  }
  for (let i = 0; i < 5; i++) await tick();
  for (const fr of frames)
    if (fr.includes("|") && !fr.endsWith("| "))
      expect(fr.startsWith("closed"), fr).toBe(fr.includes("O-closed"));
  expect(`${f}: ${l} | ${o}`).toBe("closed: [#2] | O-closed");
  dispose();
});

// The matrix around it: when the second change starts (before the guess,
// after it, after the filter's answer lands), whether `other` reads the
// guessed list, and whether filter and list share one render effect.
for (const when of ["beforeGuess", "afterGuess", "afterLanding"] as const)
  for (const reader of ["readsList", "plain"] as const)
    for (const shape of ["shared", "split"] as const)
      test(`#4577 entangled matrix: tag ${when}, other ${reader}, ${shape} (F-1, D-9)`, async () => {
        const asks: { key: string; res: (v: any) => void }[] = [];
        const ask = (key: string) => new Promise<any>(res => asks.push({ key, res }));
        const settle = async (pre: string, v: any) => {
          asks
            .splice(
              asks.findIndex(a => a.key.startsWith(pre)),
              1
            )[0]
            .res(v);
          await tick();
        };
        const frames: string[] = [];
        let f = "",
          l = "",
          o = "";
        let q = false;
        const snap = () => {
          if (!q) {
            q = true;
            queueMicrotask(() => {
              q = false;
              frames.push(`${f}: ${l} | ${o}`);
            });
          }
        };
        let setFilter!: (v: string) => void,
          setTag!: (v: string) => void,
          closeOne!: (id: number) => unknown,
          dispose!: () => void;
        createRoot(d => {
          dispose = d;
          const [filter, sf] = createSignal("open");
          setFilter = sf;
          const [tag, st] = createSignal("t0");
          setTag = st;
          const [issues, set] = createOptimisticStore<{ id: number }[]>(
            () => ask(`issues:${filter()}`),
            [],
            { key: "id" }
          );
          const other = createMemo(
            () => (reader === "readsList" && issues.length, ask(`other:${filter()}:${tag()}`))
          );
          const tagv = createMemo(() => ask(`tag:${tag()}`));
          closeOne = action(function* (id: number) {
            set(xs => {
              const i = xs.findIndex(t => t.id === id);
              if (i >= 0) xs.splice(i, 1);
            });
            yield ask(`close:${id}`);
            refresh(issues);
          });
          const list = createMemo(() => issues.map(r => `[#${r.id}]`).join(""));
          if (shape === "shared")
            createRenderEffect(
              () => [filter(), list()] as const,
              ([a, b]) => {
                f = a;
                l = b;
                snap();
              }
            );
          else {
            createRenderEffect(filter, v => {
              f = v;
              snap();
            });
            createRenderEffect(list, v => {
              l = v;
              snap();
            });
          }
          createRenderEffect(
            createErrorBoundary(
              () => other(),
              () => "ERR"
            ) as any,
            (v: any) => {
              o = String(v);
              snap();
            }
          );
          createRenderEffect(
            createErrorBoundary(
              () => String(tagv()),
              () => "ERR"
            ) as any,
            () => {}
          );
        });
        await tick();
        await settle("issues:open", [{ id: 1 }, { id: 3 }, { id: 4 }]);
        await settle("other:open", "O-open");
        await settle("tag:t0", "t0");
        setFilter("closed");
        await tick();
        if (when === "beforeGuess") (setTag("t1"), await tick());
        closeOne(1);
        await tick();
        if (when === "afterGuess") (setTag("t1"), await tick());
        await settle("issues:closed", [{ id: 1 }, { id: 2 }]);
        if (when === "afterLanding") (setTag("t1"), await tick());
        await settle("other:closed", "O-closed");
        await settle("close:1", {});
        await settle("issues:closed", [{ id: 2 }]);
        for (let k = 0; k < 20 && asks.length; k++) {
          const a = asks.shift()!;
          const p = a.key.split(":");
          a.res(
            p[0] === "other"
              ? `O-${p[1]}`
              : p[0] === "tag"
                ? p[1]
                : p[0] === "issues"
                  ? [{ id: 2 }]
                  : {}
          );
          await tick();
        }
        for (let i = 0; i < 5; i++) await tick();
        for (const fr of frames)
          if (fr.includes("|") && !fr.endsWith("| "))
            expect(fr.startsWith("closed"), fr).toBe(fr.includes("O-closed"));
        expect(`${f}: ${l} | ${o}`).toBe("closed: [#2] | O-closed");
        dispose();
      });
