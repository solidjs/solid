/**
 * #4343: how a subtree was opened does not change when its render effects
 * run. `<Loading fallback="outer"> > <Show when={ready()}> >
 * <Loading fallback="inner"> > Screen`, where Screen binds a pending async
 * memo (`<p>{data()}</p>`, caught by the inner boundary) and has a render
 * effect that reads nothing pending. That effect's first run goes through
 * with the mount (D-19), beside the inner fallback, whether `ready` is a
 * signal set later or an async memo that settles. Before, under the async
 * gate the effect waited for `data` to land. A user effect's first run is
 * queued and waits for the reveal under both gates.
 */
import { describe, expect, it } from "vitest";
import {
  createEffect,
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  untrack
} from "../src/index.js";

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => (resolve = r));
  return { promise, resolve };
}

const settle = async () => {
  for (let i = 0; i < 3; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

async function run(gate: "signal" | "async") {
  const log: string[] = [];
  const readyGate = deferred<boolean>();
  const dataGate = deferred<string>();
  const [open, setOpen] = createSignal(false);
  let slot: unknown;
  const screens: unknown[] = [];
  const snap = () => screens.push([slot, [...log]]);

  createRoot(() => {
    const ready = gate === "async" ? createMemo(() => readyGate.promise) : open;
    const screen = () => {
      const data = createMemo(async () => {
        const v = await dataGate.promise;
        log.push("data");
        return v;
      });
      createRenderEffect(
        () => 0,
        () => {
          log.push("effect");
        }
      );
      // A user effect's first run is queued: it waits behind the fallback.
      createEffect(
        () => 0,
        () => {
          log.push("user");
        }
      );
      // <p>{data()}</p>
      return () => data();
    };
    const outer = createLoadingBoundary(
      () => {
        // <Show when={ready()}>
        const condition = createMemo(() => !!ready());
        return createMemo(() =>
          condition() ? untrack(() => createLoadingBoundary(screen, () => "inner")) : undefined
        );
      },
      () => "outer"
    );
    createRenderEffect(outer, v => {
      slot = v;
    });
  });
  flush();
  snap();

  if (gate === "signal") {
    setOpen(true);
    flush();
  } else readyGate.resolve(true);
  await settle();
  snap();

  dataGate.resolve("v");
  await settle();
  snap();
  return screens;
}

describe("#4343: a render effect under a nested boundary runs when its subtree mounts", () => {
  it("gate: a signal set later", async () => {
    expect(await run("signal")).toEqual([
      [undefined, []],
      ["inner", ["effect"]],
      ["v", ["effect", "data", "user"]]
    ]);
  });

  it("gate: an async memo that settles", async () => {
    expect(await run("async")).toEqual([
      ["outer", []],
      ["inner", ["effect"]],
      ["v", ["effect", "data", "user"]]
    ]);
  });
});
