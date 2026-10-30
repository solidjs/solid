/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * S-46 through `Show` + `insert` (the signals pin is
 * `signals/tests/display-ahead-plain-write-content.test.ts`): the content a
 * display-ahead `Show` opens reads the screen, whoever opened the hold.
 *
 * A plain write to `id` is held because `detail`, an async memo over it, is
 * read plainly on screen beside the `Show`. `<Show when={latest(id)}>` opens ahead; the
 * branch is a mount whose first pass read the staging plainly, so it is born
 * held (D-27): it does not attach until the landing and the fallback stays.
 * `latest(id)` inside shows `1` now; a `<Loading>` inside shows its fallback
 * now (S-31's form). Never `0` outside beside `selected: 1` inside, and never
 * the branch attached with the committed values (`selected: 0`) while the
 * hold is open. The plain form once attached the branch with its text hole
 * empty (`selected: ` and nothing) — an empty slot (F-2), the display-ahead
 * branch form of #4417's mechanism: the branch's hole is a render effect
 * born held (D-2) that no boundary catches, so the pass that mounted it is
 * the hold's too (`recompute` → `laneStage`, F-2, D-27) and stages with the
 * transaction instead of showing with the verdict lane. The signals pin
 * passes either way because one render effect has no per-hole inserts to
 * leave empty. Each form mounts its branch once.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Loading, Show, createMemo, createSignal, flush, latest } from "solid-js";
import { render } from "../src/index.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const tick = async () => {
  await vi.advanceTimersByTimeAsync(0);
  flush();
};

type Content = "plain" | "latest" | "loading";

async function run(content: Content) {
  const div = document.createElement("div");
  const gates: (() => void)[] = [];
  const fetchDetail = (v: number) => new Promise<string>(r => gates.push(() => r(`d${v}`)));
  let setId!: (v: number) => void;
  let mounts = 0;
  const dispose = render(() => {
    const [id, _set] = createSignal(0);
    setId = _set;
    const detail = createMemo(() => fetchDetail(id()));
    const inner = () => (
      mounts++,
      content === "latest" ? <p>selected: {latest(id)}</p> : <p>selected: {id()}</p>
    );
    return (
      <>
        <b>{id()}</b>
        <i>{detail()}</i>
        <Show when={latest(id) > 0} fallback={<u>none</u>}>
          {content === "loading" ? <Loading fallback={<u>loading</u>}>{inner()}</Loading> : inner()}
        </Show>
      </>
    );
  }, div);
  const screen = () => div.textContent;
  flush();
  gates.shift()!();
  await tick();
  const screens = [screen()];

  setId(1);
  flush();
  screens.push(screen());
  await tick();
  await tick();
  screens.push(screen());

  gates.shift()!();
  await tick();
  await tick();
  screens.push(screen());
  dispose();
  return { screens, mounts };
}

describe("S-46 (web): the content a display-ahead Show opens reads the screen", () => {
  // primed | after the write's flush | a task later, still in flight | landed
  test("plain `id()` inside: born held, the fallback stays until the landing — the pass that mounted an uncaught born-held binding is the hold's (F-2, D-27, #4417)", async () => {
    const { screens, mounts } = await run("plain");
    expect(screens).toEqual(["0d0none", "0d0none", "0d0none", "1d1selected: 1"]);
    // Once: the branch is mounted by the pass that opened it, and that pass
    // is the hold's — nothing re-mounts it at the park or the landing.
    expect(mounts).toBe(1);
  });

  test("`latest(id)` inside: the held value now (D-27: the read that asks sees ahead, at its own site)", async () => {
    const { screens, mounts } = await run("latest");
    expect(screens).toEqual(["0d0none", "0d0selected: 1", "0d0selected: 1", "1d1selected: 1"]);
    expect(mounts).toBe(1);
  });

  test("a `Loading` inside: its fallback now, the content at the landing (S-31's form)", async () => {
    const { screens, mounts } = await run("loading");
    expect(screens).toEqual(["0d0none", "0d0loading", "0d0loading", "1d1selected: 1"]);
    expect(mounts).toBe(1);
  });
});
