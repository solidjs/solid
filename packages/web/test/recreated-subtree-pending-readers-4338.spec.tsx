/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// #4338: a section the change mounts commits once both of its async memos
// have landed (F-2: the old section stays until then, then the new one shows
// whole) — also when two sibling <Errored> boundaries read isPending() of
// the same memo and that memo lands after the other one.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  Errored,
  For,
  Loading,
  Show,
  createMemo,
  createSignal,
  flush,
  isPending,
  latest
} from "solid-js";
import { render } from "../src/index.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const latestOr = <T,>(read: () => T, fallback: T): T => {
  try {
    return latest(read) ?? fallback;
  } catch {
    return fallback;
  }
};
const section = (k: string) =>
  `<div><p>fast-${k}</p><b>slow-${k}</b><!----><span>side</span><!----></div>`;

for (const [label, fastMs, slowMs, loading] of [
  ["twice-read memo lands last", 5, 30, true],
  ["twice-read memo lands last, no <Loading>", 5, 30, false],
  ["twice-read memo lands first", 30, 5, true]
] as const)
  test(`the re-created section commits whole (${label})`, async () => {
    function Section(props: { k: string }) {
      const fast = createMemo(async () => {
        await sleep(fastMs);
        return "fast-" + props.k;
      });
      const slow = createMemo(async () => {
        await sleep(slowMs);
        return "slow-" + props.k;
      });
      return (
        <div>
          <Errored fallback={<i>err1</i>}>
            <Show when={!isPending(() => fast())}>
              <p>{latestOr(() => fast(), "")}</p>
              <Show when={!isPending(() => slow())}>
                <b>{latestOr(() => slow(), "")}</b>
              </Show>
            </Show>
          </Errored>
          <Errored fallback={<i>err2</i>}>
            <Show when={!isPending(() => slow())}>
              <span>side</span>
            </Show>
          </Errored>
        </div>
      );
    }
    const [key, setKey] = createSignal("a");
    const list = createMemo(() => [key()]);
    const container = document.createElement("div");
    const rows = () => <For each={list()}>{k => <Section k={k} />}</For>;
    const dispose = render(
      () => (loading ? <Loading fallback={<i>loading</i>}>{rows()}</Loading> : rows()),
      container
    );
    const before = loading ? "<i>loading</i>" : "";
    const frames = async (from: string, to: string) => {
      const last = Math.max(fastMs, slowMs);
      for (let t = 0; t < last; t += 5) {
        expect(container.innerHTML).toBe(from);
        await vi.advanceTimersByTimeAsync(5);
        flush();
      }
      expect(container.innerHTML).toBe(to);
    };
    await frames(before, section("a"));
    setKey("b");
    flush();
    await frames(section("a"), section("b"));
    dispose();
  });
