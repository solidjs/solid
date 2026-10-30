/**
 * S-46 (D-27, D-37; ruled 2026-10-30): the content a display-ahead `Show`
 * opens reads the screen, whoever opened the hold.
 *
 * A plain write to `id` is held because an async memo over it is on screen.
 * `<Show when={latest(id)}>` opens at once — `latest` is the read that asks
 * ahead — but a plain `id()` inside the branch is an independent read: it
 * means the same thing as the `<p>{id()}</p>` outside, the committed value.
 * The branch's first pass read the staging under a display-ahead reader, so
 * it is born held (D-27): it does not attach until the landing, and the
 * screen keeps the fallback. `latest(id)` inside shows `1` now; a `Loading`
 * inside shows its fallback now (S-31's form). Never `0` outside beside
 * `selected: 1` inside — two plain reads of one signal disagreeing on one
 * screen.
 *
 * S-31 (`verdict-mount-first-pass-3851`) pins the action + `Loading` form.
 * This is the plain-write, no-boundary form — "actions aren't special; they
 * are a way to extend the hold" — pinned so the rule's reach is explicit.
 */
import { describe, expect, it } from "vitest";
import {
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  latest,
  untrack
} from "../src/index.js";

const settle = async () => {
  for (let i = 0; i < 3; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

type Content = "plain" | "latest" | "loading";

async function run(content: Content) {
  const [id, setId] = createSignal(0);
  const gates: ((v: string) => void)[] = [];
  const fetchDetail = (v: number) => new Promise<string>(r => gates.push(() => r(`d${v}`)));
  let screenId: unknown;
  let slot: unknown;
  let screenDetail: unknown;
  createRoot(() => {
    // <p>{id()}</p>
    createRenderEffect(id, v => {
      screenId = v;
    });
    // <p>{detail()}</p> — the async over `id` that holds a write to it
    const detail = createMemo(() => fetchDetail(id()));
    createRenderEffect(detail, v => {
      screenDetail = v;
    });
    // <Show when={latest(id)} fallback="none">…</Show> — the branch is a
    // mount: a render effect created under the display-ahead reader, as
    // `Show` + `insert` create one for the child.
    const when = createMemo(() => latest(id) > 0);
    const children = createMemo(() =>
      when()
        ? untrack(() => {
            if (content === "loading")
              return createLoadingBoundary(
                () => `selected: ${id()}`,
                () => "fallback"
              );
            createRenderEffect(
              () => `selected: ${content === "latest" ? latest(id) : id()}`,
              v => {
                slot = v;
              }
            );
            return "opened";
          })
        : "none"
    );
    createRenderEffect(
      () => {
        const c = children();
        return typeof c === "function" ? c() : c;
      },
      v => {
        // the mounted leaf writes the slot itself; "opened" is the branch
        // existing with its leaf not yet attached
        if (v !== "opened") slot = v;
      }
    );
  });
  flush();
  gates.shift()!("d0");
  await settle();
  const screens: unknown[] = [[screenId, slot, screenDetail]];

  setId(1);
  flush();
  await settle();
  screens.push([screenId, slot, screenDetail]);

  gates.shift()!("d1");
  await settle();
  screens.push([screenId, slot, screenDetail]);
  return screens;
}

describe("S-46: the content a display-ahead Show opens reads the screen (plain-write hold)", () => {
  it("plain `id()` inside: the branch is born held, the fallback stays until the landing", async () => {
    expect(await run("plain")).toEqual([
      [0, "none", "d0"],
      [0, "none", "d0"],
      [1, "selected: 1", "d1"]
    ]);
  });

  it("`latest(id)` inside: the branch shows the held value now", async () => {
    expect(await run("latest")).toEqual([
      [0, "none", "d0"],
      [0, "selected: 1", "d0"],
      [1, "selected: 1", "d1"]
    ]);
  });

  it("a `Loading` inside: its fallback now, the content at the landing (S-31's form)", async () => {
    expect(await run("loading")).toEqual([
      [0, "none", "d0"],
      [0, "fallback", "d0"],
      [1, "selected: 1", "d1"]
    ]);
  });
});
