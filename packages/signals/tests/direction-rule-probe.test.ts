/**
 * The hold waits for a first load a render effect consumes outside a
 * boundary (F-2, D-6; the direction rule's time half — "a hold never waits
 * on work that has never committed", 2026-10-06 — is withdrawn, 2026-10-09).
 * Each shape mounts a first load (`page`, an async memo over `user`) while an
 * action holds `user = "bob"`: the header stays on "ann" until the pages
 * land, then "bob" and the pages appear together.
 *
 * Under a fresh Loading the boundary catches the page: the hold does not
 * wait for it, and the boundary shows its fallback meanwhile (#3540).
 */
import { expect, it } from "vitest";
import {
  action,
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  untrack
} from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  flush();
};

type Shape = "two-mounts-outside" | "one-mount-then-sync-reader" | "in-flush" | "in-flush-boundary";

/** The full log, and what showed at the action's release. */
async function run(shape: Shape) {
  const [user, setUser] = createSignal("ann");
  const [open, setOpen] = createSignal(false);
  const log: string[] = [];
  const gates: Array<() => void> = [];
  const page = () =>
    createMemo(async () => {
      const u = user();
      await new Promise<void>(r => gates.push(r));
      return `page-${u}`;
    });
  createRoot(() => {
    createRenderEffect(user, u => void log.push(`header ${u}`));
    if (shape === "in-flush" || shape === "in-flush-boundary")
      createRenderEffect(
        () => {
          if (!open()) return;
          if (shape === "in-flush-boundary") {
            const view = untrack(() =>
              createLoadingBoundary(
                () => page()(),
                () => "fallback"
              )
            );
            createRenderEffect(view, x => void log.push(`view ${x}`));
          } else createRenderEffect(page(), x => void log.push(`page ${x}`));
        },
        () => {}
      );
  });
  flush();
  let release!: () => void;
  action(function* () {
    setUser("bob");
    yield new Promise<void>(r => (release = r));
  })();
  flush();
  if (shape === "two-mounts-outside")
    for (const n of [1, 2])
      createRoot(() => createRenderEffect(page(), x => void log.push(`page${n} ${x}`)));
  else if (shape === "one-mount-then-sync-reader") {
    createRoot(() => createRenderEffect(page(), x => void log.push(`page ${x}`)));
    createRoot(() => {
      const m = createMemo(() => user().toUpperCase());
      createRenderEffect(m, x => void log.push(`sync ${x}`));
    });
  } else setOpen(true);
  flush();
  const beforeRelease = log.length;
  release();
  await tick();
  const atRelease = log.slice(beforeRelease);
  gates.splice(0).forEach(g => g());
  await tick();
  return { log, atRelease };
}

it("same tick, two mounts outside a flush: the hold waits for both pages", async () => {
  const r = await run("two-mounts-outside");
  expect(r.atRelease).toEqual([]);
  expect(r.log).toEqual(expect.arrayContaining(["header bob", "page1 page-bob", "page2 page-bob"]));
});

it("same tick, a mount then a sync reader: the hold waits for the page", async () => {
  const r = await run("one-mount-then-sync-reader");
  expect(r.atRelease).toEqual([]);
  expect(r.log).toEqual(expect.arrayContaining(["header bob", "page page-bob", "sync BOB"]));
});

it("in a flush that joined the hold: the hold waits for the mount's first load", async () => {
  const r = await run("in-flush");
  expect(r.atRelease).toEqual([]);
  expect(r.log).toEqual(expect.arrayContaining(["header bob", "page page-bob"]));
});

it("in a flush, under a Loading that has not shown content: the hold lands at its release; the boundary shows its fallback meanwhile", async () => {
  const r = await run("in-flush-boundary");
  expect(r.log.slice(0, 2)).toEqual(["header ann", "view fallback"]);
  expect(r.atRelease).toEqual(["header bob"]);
});
