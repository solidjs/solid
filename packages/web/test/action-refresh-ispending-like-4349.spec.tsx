/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #4349: the Like button — `isPending(likes) ? … : likes()` under a
// <Loading>, an action that refreshes `likes`. The action's transaction
// lands beneath the re-ask's flight; the button's text then observes the
// flight and holds a frame of its own, with the ternary's condition memo
// held in it. That memo probed only the flight, so it re-derives at the
// landing, not every round (the dev guard's "Potential Infinite Loop … last
// staged node: button.children"). A bare refresh is a quiet re-ask (F-9):
// the button keeps `v41` until `v42` lands. `affects(likes)` declares the
// reload: `pending`, then `v42`.
import { expect, test } from "vitest";
import { Loading, action, affects, createMemo, flush, isPending, refresh } from "solid-js";
import { render } from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  flush();
};

type Shape = { affects: boolean; order: "yield-refresh" | "refresh-yield" | "refresh" };
const shapes: Shape[] = [];
for (const a of [true, false])
  for (const order of ["yield-refresh", "refresh-yield", "refresh"] as const)
    shapes.push({ affects: a, order });

for (const shape of shapes)
  test(`Like button settles: ${shape.affects ? "affects + " : ""}${shape.order}`, async () => {
    const errors: unknown[] = [];
    const onError = (e: unknown) => errors.push(e);
    process.on("unhandledRejection", onError);
    try {
      let server = 41;
      const fetches: (() => void)[] = [];
      let saved!: () => void;
      const container = document.body.appendChild(document.createElement("div"));
      let clickLike!: () => void;
      const frames: string[] = [];
      const observer = new MutationObserver(() => {
        const text = container.textContent!;
        if (frames.at(-1) !== text) frames.push(text);
      });
      observer.observe(container, { subtree: true, childList: true, characterData: true });
      const LikeButton = () => {
        const likes = createMemo(async () => {
          const v = server;
          await new Promise<void>(r => fetches.push(r));
          return v;
        });
        const like = action(function* () {
          if (shape.affects) affects(likes);
          if (shape.order === "yield-refresh") {
            yield new Promise<void>(r => (saved = r));
            server++;
            refresh(likes);
          } else {
            server++;
            refresh(likes);
            if (shape.order === "refresh-yield") yield new Promise<void>(r => (saved = r));
          }
        });
        clickLike = () => like();
        return (
          <button onClick={() => like()}>{isPending(likes) ? "pending" : `v${likes()}`}</button>
        );
      };
      render(
        () => (
          <Loading fallback={<i>loading</i>}>
            <LikeButton />
          </Loading>
        ),
        container
      );
      await tick();
      expect(container.textContent).toBe("loading");
      fetches.shift()!();
      await tick();
      expect(container.textContent).toBe("v41");

      clickLike();
      await tick();
      const during = shape.affects ? "pending" : "v41";
      expect(container.textContent).toBe(during);
      if (shape.order !== "refresh") {
        saved();
        await tick();
        expect(container.textContent).toBe(during);
      }
      expect(fetches.length).toBe(1);
      fetches.shift()!();
      await tick();
      expect(container.textContent).toBe("v42");
      await tick();
      observer.disconnect();
      container.remove();
      expect(frames).toEqual([
        "loading",
        "v41",
        ...(during === "pending" ? ["pending"] : []),
        "v42"
      ]);
      expect(errors).toEqual([]);
    } finally {
      process.off("unhandledRejection", onError);
    }
  });
