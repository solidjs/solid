/**
 * #3851: a mount a verdict reader makes is a mainline mount. An action
 * holds `x = 1`; `<Show when={latest(x) > 0}>` opens at once (display-ahead)
 * and mounts a `<Loading>` whose content reads `x`. A verdict lane computes
 * the real outcome and its mounts stay mainline (A29's boundary exemption),
 * so the content reads the held `x` as the frame does: it waits behind the
 * fresh boundary's fallback and appears at the action's landing (A29's
 * boundary scope, 2026-10-06). Before, the content's first pass was staged
 * in the verdict lane its creator was in and showed `content 1` beside the
 * committed `x = 0`.
 */
import { describe, expect, it } from "vitest";
import {
  action,
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

async function mountUnderVerdict(contentInMemo: boolean | "async") {
  const [x, setX] = createSignal(0);
  let screenX: unknown;
  let slot: unknown;
  createRoot(() => {
    // <p>{x()}</p>
    createRenderEffect(x, v => {
      screenX = v;
    });
    // <Show when={latest(x) > 0}>
    //   <Loading fallback="fallback">content {x()}</Loading>
    // </Show>
    const when = createMemo(() => latest(x) > 0);
    const children = createMemo(() =>
      when()
        ? untrack(() =>
            createLoadingBoundary(
              contentInMemo === "async"
                ? createMemo(() => Promise.resolve(`content ${x()}`))
                : contentInMemo
                  ? createMemo(() => `content ${x()}`)
                  : () => `content ${x()}`,
              () => "fallback"
            )
          )
        : "closed"
    );
    createRenderEffect(
      () => {
        const c = children();
        return typeof c === "function" ? c() : c;
      },
      v => {
        slot = v;
      }
    );
  });
  flush();
  const screens: unknown[] = [[screenX, slot]];

  let release!: () => void;
  const done = action(function* () {
    setX(1);
    yield new Promise<void>(r => (release = r));
  })();
  await settle();
  screens.push([screenX, slot]);

  release();
  await done;
  await settle();
  screens.push([screenX, slot]);
  return screens;
}

describe("#3851: a verdict reader's mount stays mainline", () => {
  it("the mounted boundary shows its fallback while the action holds the value", async () => {
    expect(await mountUnderVerdict(false)).toEqual([
      [0, "closed"],
      [0, "fallback"],
      [1, "content 1"]
    ]);
  });

  it("same with the content in a memo", async () => {
    expect(await mountUnderVerdict(true)).toEqual([
      [0, "closed"],
      [0, "fallback"],
      [1, "content 1"]
    ]);
  });

  it("same with an async content memo", async () => {
    expect(await mountUnderVerdict("async")).toEqual([
      [0, "closed"],
      [0, "fallback"],
      [1, "content 1"]
    ]);
  });
});
