/**
 * #4271: a projection over a memo follows the memo after it has shown a
 * value — the memo going pending again reports pending through the
 * projection, and a later throw reaches the error boundary.
 */
import { expect, it } from "vitest";
import {
  createErrorBoundary,
  createMemo,
  createProjection,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  untrack
} from "../src/index.js";

it("#4271: a projection over a memo reports its later pending and errors", async () => {
  const [q, setQ] = createSignal("a");
  let resolveB!: (v: { id: number; n: string }[]) => void;
  let screen = "";
  const dispose = createRoot(d => {
    const src = createMemo(() => {
      const v = q();
      if (v === "a") throw new Error("too short");
      if (v === "b") return new Promise<{ id: number; n: string }[]>(r => (resolveB = r));
      return [{ id: 1, n: v }];
    });
    const proj = createProjection(() => src(), [], { key: "id" });
    const out = untrack(() =>
      createErrorBoundary(
        () => `${proj.length} ${isPending(() => proj.length) ? "pending" : "-"}`,
        err => "error:" + (err() as Error).message
      )
    );
    createRenderEffect(
      () => out(),
      v => {
        screen = v;
      }
    );
    return d;
  });
  const tick = async () => {
    await new Promise(r => setTimeout(r, 0));
    flush();
  };
  flush();
  await tick();
  expect(screen).toBe("error:too short");
  setQ("c");
  flush();
  await tick();
  expect(screen).toBe("1 -");
  setQ("b");
  flush();
  await tick();
  expect(screen).toBe("1 pending");
  resolveB([
    { id: 2, n: "b" },
    { id: 3, n: "b" }
  ]);
  await tick();
  expect(screen).toBe("2 -");
  setQ("a");
  flush();
  await tick();
  expect(screen).toBe("error:too short");
  dispose();
});
