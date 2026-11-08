/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * S-58 (D-25): a display-ahead gate is the same mainline mount with any
 * number of memos between the probe and the branch. `<Show when={latest(s)
 * > 0}>` (two memos), the compiled ternary, a truthiness memo over the probe
 * with a branch memo reading it (one), and one memo that probes and mounts
 * (none) all keep the fallback through `m0`'s flight and attach at the
 * landing. PR #4708 pinned the one-hop form as never painting; with real
 * JSX it painted at the landing and tore only during the flight. The last
 * case is S-53′: the plain read under an errored boundary inside an action,
 * which the lane revealed with its hole empty until the mount under an open
 * action counted as waiting.
 */
import { expect, test } from "vitest";
import { Errored, Show, action, createMemo, createSignal, flush, latest } from "solid-js";
import { render } from "../src/index.js";
const tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  flush();
};
for (const shape of ["Show", "ternary", "one-hop", "zero-hop"] as const)
  test(`gate ${shape}`, async () => {
    const div = document.createElement("div");
    const gates: (() => void)[] = [];
    let setS!: (v: number) => void;
    const dispose = render(() => {
      const [s, _set] = createSignal(0);
      setS = _set;
      const m0 = createMemo(async () => {
        const v = s();
        await new Promise<void>(r => gates.push(r));
        return v;
      });
      const leaf = () => <span data-a0={m0()}>x</span>;
      if (shape === "Show")
        return (
          <Show when={latest(s) > 0} fallback={<i>F</i>}>
            {leaf()}
          </Show>
        );
      if (shape === "ternary") return <>{latest(s) > 0 ? leaf() : <i>F</i>}</>;
      if (shape === "one-hop") {
        const cond = createMemo(() => latest(s) > 0, { equals: (a, b) => !a === !b });
        return createMemo(() => (cond() ? leaf() : <i>F</i>)) as any;
      }
      return createMemo(() => (latest(s) > 0 ? leaf() : <i>F</i>)) as any;
    }, div);
    const out: string[] = [];
    flush();
    gates.shift()!();
    await tick();
    out.push(div.innerHTML);
    setS(1);
    flush();
    out.push(div.innerHTML);
    await tick();
    out.push(div.innerHTML);
    gates.shift()!();
    await tick();
    await tick();
    out.push(div.innerHTML);
    dispose();
    expect(out.join(" | ")).toBe('<i>F</i> | <i>F</i> | <i>F</i> | <span data-a0="1">x</span>');
  });
test("S-53 prime: plain read under an errored boundary in an action", async () => {
  const div = document.createElement("div");
  let setS!: (v: number) => void;
  const dispose = render(() => {
    const [s, _set] = createSignal(0);
    setS = _set;
    const m = createMemo(() => {
      const v = s() + 1;
      if (v === 2) throw new Error("m:2");
      return v;
    });
    return (
      <Errored fallback={<i>E</i>}>
        <Show when={latest(m)} fallback={<i>F</i>}>
          <span>{s()}</span>
        </Show>
      </Errored>
    );
  }, div);
  flush();
  setS(1);
  flush();
  await tick();
  const out = [div.innerHTML];
  let release!: () => void;
  const done = action(function* () {
    setS(0);
    yield new Promise<void>(r => (release = r));
  })();
  flush();
  out.push(div.innerHTML);
  await tick();
  out.push(div.innerHTML);
  release();
  await done;
  await tick();
  await tick();
  out.push(div.innerHTML);
  dispose();
  expect(out.join(" | ")).toBe("<i>E</i> | <i>E</i> | <i>E</i> | <span>0</span>");
});
