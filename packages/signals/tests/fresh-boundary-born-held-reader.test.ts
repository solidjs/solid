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
  flush,
  isPending
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

// `isPending` of a memo born held: no committed value, no verdict — it reads
// as the memo's read does (D-23). Inside the boundary it is caught with the
// content; outside, it holds the change that mounted it. Unowned, false.
function mountVerdict(inside: boolean, after = false) {
  const log: string[] = [];
  const [x, setX] = createSignal(0);
  const [open, setOpen] = createSignal(false);
  let m!: () => number;
  createRoot(() => {
    const branch = createMemo(() => {
      if (!open()) return "closed";
      m = createMemo(() => x());
      const spinner = () => (isPending(m) ? "updating" : "idle");
      if (!inside && !after) createRenderEffect(spinner, v => void log.push(`spinner ${v}`));
      const b = createLoadingBoundary(
        () => {
          createRenderEffect(m, v => void log.push(`p ${v}`));
          if (inside) createRenderEffect(spinner, v => void log.push(`spinner ${v}`));
          return "content";
        },
        () => "fallback"
      );
      if (after) createRenderEffect(spinner, v => void log.push(`spinner ${v}`));
      return b;
    });
    createRenderEffect(
      () => {
        const b = branch();
        return typeof b === "function" ? b() : b;
      },
      v => void log.push(`view ${v}`)
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
  return { log, m: () => m, release: () => release() };
}

it("isPending of a memo born held, read inside the boundary: caught with the content", async () => {
  const s = mountVerdict(true);
  await tick();
  expect(isPending(s.m())).toBe(false);
  s.log.push("release");
  s.release();
  await tick();
  expect(s.log).toEqual([
    "view closed",
    "view fallback",
    "release",
    "p 1",
    "spinner idle",
    "view content"
  ]);
});

it("isPending of a memo born held, read outside the boundary: holds the change", async () => {
  const s = mountVerdict(false);
  await tick();
  s.log.push("release");
  s.release();
  await tick();
  // Nothing of the branch before the commit; at it, the content (D-13's
  // pinned gap: the boundary's first pass staged its fallback, replaced in
  // the commit's own flush — `loading-fallback-in-flush-3540`).
  expect(s.log.slice(0, 2)).toEqual(["view closed", "release"]);
  expect(s.log).toContain("spinner idle");
  expect(s.log.at(-1)).toBe("view content");
});

it("isPending of a memo born held, read outside after the boundary: holds the change", async () => {
  const s = mountVerdict(false, true);
  await tick();
  s.log.push("release");
  s.release();
  await tick();
  expect(s.log.slice(0, 2)).toEqual(["view closed", "release"]);
  expect(s.log).toContain("spinner idle");
  expect(s.log.at(-1)).toBe("view content");
});
