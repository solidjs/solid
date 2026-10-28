/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import {
  Loading,
  Show,
  createEffect,
  createMemo,
  createRenderEffect,
  createSignal,
  flush
} from "solid-js";
import { render } from "../src/index.js";

// #4343: `<Loading> > <Show when={ready()}> > <Loading fallback="inner"> > Screen`,
// where Screen reads a pending async memo and has a render effect that reads
// nothing pending. The inner boundary catches Screen's pending read; the
// render effect's first run goes through when its subtree mounts (D-19),
// whether `ready` is a signal set later or an async memo that settles. A
// user effect's first run is queued and waits for the reveal under both.
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => (resolve = r));
  return { promise, resolve };
}

async function settle() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  flush();
}

async function run(gate: "signal" | "async") {
  const el = document.createElement("div");
  const log: string[] = [];
  const screens: [string, string[]][] = [];
  const snap = () => screens.push([el.textContent!, [...log]]);
  const readyGate = deferred<boolean>();
  const dataGate = deferred<string>();
  const [open, setOpen] = createSignal(false);

  function Screen() {
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
    createEffect(
      () => 0,
      () => {
        log.push("user");
      }
    );
    return <p>{data()}</p>;
  }

  const dispose = render(() => {
    const ready = gate === "async" ? createMemo(() => readyGate.promise) : open;
    return (
      <Loading fallback="outer">
        <Show when={ready()}>
          <Loading fallback="inner">
            <Screen />
          </Loading>
        </Show>
      </Loading>
    );
  }, el);
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
  dispose();
  return screens;
}

describe("#4343: a render effect under a nested <Loading> runs when its subtree mounts", () => {
  for (const gate of ["signal", "async"] as const)
    it(`runs while the inner fallback shows (gate: ${gate})`, async () => {
      expect(await run(gate)).toEqual([
        [gate === "signal" ? "" : "outer", []],
        ["inner", ["effect"]],
        ["v", ["effect", "data", "user"]]
      ]);
    });
});
