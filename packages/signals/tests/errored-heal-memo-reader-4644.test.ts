import { expect, it } from "vitest";
import {
  createErrorBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush
} from "../src/index.js";

// #4644 (D-39, F-3, F-12): a fallback no live reader holds heals. The shape:
// `<Errored><Show when={page() === "list"} fallback="about">{X}</Show>
// </Errored>`, `rows` an async memo owned outside the boundary that rejects.
// X = "memo-only": `rows` is read only by memos (a `<Show when>` condition)
// whose value the boundary's tree flattens, so the reader the boundary
// caught is its own tree. X = "effect": a render effect in the branch reads
// it. Navigating away disposes every reader of `rows`: nothing on the new
// branch reads the error, so the boundary shows it, as a fresh render with
// the same inputs would. With another live reader of `rows` under the same
// boundary ("kept"), the error stays up.
const tick = async () => {
  for (let i = 0; i < 3; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

for (const shape of ["memo-only", "effect", "kept"] as const)
  it(`${shape}: navigating away from a failed memo (#4644)`, async () => {
    let reject!: (e: Error) => void;
    const [page, setPage] = createSignal("list");
    const frames: unknown[] = [];
    const dispose = createRoot(d => {
      const rows = createMemo(
        () =>
          new Promise<number[]>((_, r) => {
            reject = r;
          })
      );
      const view = createErrorBoundary(
        () => {
          if (shape === "kept")
            createRenderEffect(
              () => rows().length,
              () => {}
            );
          const onList = createMemo(() => page() === "list");
          return createMemo(() => {
            if (!onList()) return "about";
            if (shape === "effect") {
              createRenderEffect(
                () => rows().length,
                () => {}
              );
              return "list";
            }
            const cond = createMemo(() => rows().length === 0);
            return createMemo(() => (cond() ? "none" : "some"));
          });
        },
        () => "ERR"
      );
      createRenderEffect(
        () => view(),
        v => {
          frames.push(v);
        }
      );
      return d;
    });
    flush();
    await tick();
    reject(new Error("boom"));
    await tick();
    expect(frames[frames.length - 1]).toBe("ERR");
    setPage("about");
    flush();
    await tick();
    dispose();
    expect(frames[frames.length - 1]).toBe(shape === "kept" ? "ERR" : "about");
  });
