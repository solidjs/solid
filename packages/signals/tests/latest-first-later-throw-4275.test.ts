/**
 * #4275 (S-39, D-28): a read throws on its own; an earlier read does not
 * disarm a later throw. An action holds `s = 1` while `n0(1)` is in flight
 * and nothing on screen reads `n0`. A `<Show>` then mounts a reader of
 * `latest(s)` and `n0()`. Either read order holds the mount: control stays
 * off until `n0(1)` lands, then control and `[1, 1]` together. Before, the
 * `latest`-first order put the reader in the lane, `n0()` waited as lane
 * work instead of throwing, and the branch published with its slot empty.
 */
import { describe, expect, it } from "vitest";
import {
  action,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  latest
} from "../src/index.js";

const tick = async () => {
  await new Promise(r => setTimeout(r, 0));
  flush();
};

async function run(order: "latest-first" | "n0-first") {
  const [s, setS] = createSignal(0);
  const [mounted, setMounted] = createSignal(false);
  const resolvers = new Map<number, (v: number) => void>();
  let control: unknown;
  let slot: unknown;
  createRoot(() => {
    const n0 = createMemo(async () => new Promise<number>(r => resolvers.set(latest(s), r)));
    const reader = () =>
      order === "latest-first" ? `[${latest(s)}, ${n0()}]` : `[${n0()}, ${latest(s)}]`;
    const opts = { transparent: true, sync: true };
    // <p>{mounted() ? "on" : "off"}</p>
    createRenderEffect(
      () => (mounted() ? "on" : "off"),
      v => {
        control = v;
      },
      opts
    );
    // <Show when={mounted()}>{reader}</Show>: the insert's outer binding
    // reads the branch and hands a function child to an inner binding.
    const when = createMemo(() => mounted(), { sync: true });
    const children = createMemo(() => (when() ? reader : undefined), { sync: true });
    createRenderEffect(
      () => {
        const c = children();
        if (typeof c !== "function") return c;
        createRenderEffect(
          c,
          v => {
            slot = v;
          },
          opts
        );
      },
      v => {
        slot = v;
      },
      opts
    );
  });
  flush();
  await tick();
  let release!: () => void;
  action(function* () {
    setS(1);
    yield new Promise<void>(r => (release = r));
  })();
  flush();
  await tick();
  const screens: unknown[] = [[control, slot]];
  setMounted(true);
  flush();
  await tick();
  screens.push([control, slot]);
  resolvers.get(1)?.(1);
  await tick();
  await tick();
  screens.push([control, slot]);
  release();
  await tick();
  await tick();
  return screens;
}

describe("#4275: an earlier latest() read does not disarm a later throw", () => {
  it("n0-first holds the mount", async () => {
    expect(await run("n0-first")).toEqual([
      ["off", undefined],
      ["off", undefined],
      ["on", "[1, 1]"]
    ]);
  });

  it("latest-first holds the mount too", async () => {
    expect(await run("latest-first")).toEqual([
      ["off", undefined],
      ["off", undefined],
      ["on", "[1, 1]"]
    ]);
  });
});
