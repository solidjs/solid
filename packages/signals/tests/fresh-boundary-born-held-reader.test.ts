// A memo created outside a fresh <Loading>, born in a hold, read only by a
// render effect inside the boundary: the boundary catches the read and shows
// its fallback now; the content reveals at the commit (#3540). The memo's
// first pass does not pull the mount into the hold — the reader's position
// decides, not where the memo was created.
import { expect, it } from "vitest";
import {
  action,
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush
} from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  flush();
};

it("a fresh boundary catches its reader of a memo born held outside it", async () => {
  const log: string[] = [];
  const [x, setX] = createSignal(0);
  const [open, setOpen] = createSignal(false);
  createRoot(() => {
    const branch = createMemo(() => {
      if (!open()) return "closed";
      const m = createMemo(() => x());
      return createLoadingBoundary(
        () => {
          createRenderEffect(m, v => {
            log.push(`p ${v}`);
          });
          return "content";
        },
        () => "fallback"
      );
    });
    createRenderEffect(
      () => {
        const b = branch();
        return typeof b === "function" ? b() : b;
      },
      v => {
        log.push(`view ${v}`);
      }
    );
  });
  flush();
  let release!: () => void;
  action(function* () {
    setX(1);
    yield new Promise<void>(r => (release = r));
  })();
  flush();
  setOpen(true);
  flush();
  await tick();
  log.push("release");
  release();
  await tick();
  expect(log).toEqual(["view closed", "view fallback", "release", "p 1", "view content"]);
});
