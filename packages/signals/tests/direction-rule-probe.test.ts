/**
 * The direction rule (SPEC "The hold model — L2", amendment 2026-10-06): a
 * hold never waits on work that has never committed. Each shape below
 * mounts a first load (`page`, an async memo over `user`) while an action
 * holds `user = "bob"`; the hold's own reader (`header`) must show "bob" at
 * the action's release, never waiting on the pages' first loads.
 *
 * The same-tick and in-flush shapes are recorded by the amendment as not yet
 * one-way — the frame of a tick is one transaction, so the hold waits with
 * the mount — and are pinned `it.fails` until a ruling makes them one-way.
 * The boundary shape is one-way today (#3540's boundary scope).
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

it.fails(
  "same tick, two mounts outside a flush: the hold lands at its release, before the pages' first loads",
  async () => {
    const r = await run("two-mounts-outside");
    expect(r.atRelease).toEqual(["header bob"]);
    expect(r.log).toEqual(expect.arrayContaining(["page1 page-bob", "page2 page-bob"]));
  }
);

it.fails(
  "same tick, a mount then a sync reader: the hold lands at its release, before the page's first load",
  async () => {
    const r = await run("one-mount-then-sync-reader");
    expect(r.atRelease).toEqual(["header bob"]);
    expect(r.log).toEqual(expect.arrayContaining(["page page-bob", "sync BOB"]));
  }
);

it.fails(
  "in a flush that joined the hold: the hold lands at its release, before the mount's first load",
  async () => {
    const r = await run("in-flush");
    expect(r.atRelease).toEqual(["header bob"]);
    expect(r.log).toEqual(expect.arrayContaining(["page page-bob"]));
  }
);

it("in a flush, under a Loading that has not shown content: the hold lands at its release; the boundary shows its fallback meanwhile", async () => {
  const r = await run("in-flush-boundary");
  expect(r.log.slice(0, 2)).toEqual(["header ann", "view fallback"]);
  expect(r.atRelease).toEqual(["header bob"]);
});
