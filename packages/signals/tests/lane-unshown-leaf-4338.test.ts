/**
 * #4338: a render effect that reads a verdict lane's node while that lane is
 * held and has never shown waits for the lane's reveal. The node has no
 * committed value, so the leaf throws NotReady and its pending holds its
 * frame (F-2); that throw names no flight, so nothing but the reveal can
 * re-derive it. It was registered for the reveal only when it did not
 * throw, so the leaf stayed pending: the hold waited on it, and it waited on
 * a lane that ends only when the hold lands.
 *
 * Shape (the issue's `<Section>`): two `<Errored>` boundaries read
 * `isPending(slow)`, one of them nested under `isPending(fast)`. `fast`
 * lands first and mounts the nested reader, whose pending on `slow` holds
 * the verdict lane; `slow` lands next and the sibling boundary's output
 * becomes a lane node before the lane has shown.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  createErrorBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  flush,
  isPending,
  latest
} from "../src/index.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const latestOr = (read: () => string) => {
  try {
    return latest(read) ?? "";
  } catch {
    return "";
  }
};
/** `<Show when>` with a static child: the child is built in the value memo. */
function Show(when: () => unknown, children: () => unknown) {
  const value = createMemo(when);
  const condition = createMemo(value, { equals: (a, b) => !a === !b });
  return createMemo(() => (condition() ? children() : undefined));
}
interface El {
  tag: string;
  text?: string;
}
const el = (tag: string, text?: () => string): El => {
  const node: El = { tag };
  if (text) createRenderEffect(text, v => void (node.text = v));
  return node;
};
const unwrap = (v: unknown): unknown =>
  typeof v === "function" ? unwrap(v()) : Array.isArray(v) ? v.map(unwrap) : v;
const html = (v: unknown): string =>
  Array.isArray(v)
    ? v.map(html).join("")
    : v == null
      ? ""
      : typeof v === "object"
        ? `<${(v as El).tag}>${(v as El).text ?? ""}</${(v as El).tag}>`
        : String(v);

for (const [label, fastMs, slowMs, errored] of [
  ["the twice-read memo lands last", 5, 30, true],
  ["the twice-read memo lands last, no error boundaries", 5, 30, false],
  ["the twice-read memo lands first", 30, 5, true]
] as const)
  it(`#4338: every reader of isPending(slow) shows when both land (${label})`, async () => {
    const shown: { a?: unknown; b?: unknown } = {};
    const screen = () => html(shown.a) + "|" + html(shown.b);
    const dispose = createRoot(d => {
      const fast = createMemo(async () => (await sleep(fastMs), "fast"));
      const slow = createMemo(async () => (await sleep(slowMs), "slow"));
      const boundary = (fn: () => unknown) =>
        errored ? createErrorBoundary(fn, () => "err") : fn();
      const first = boundary(() =>
        Show(
          () => !isPending(() => fast()),
          () => [
            el("p", () => latestOr(() => fast())),
            Show(
              () => !isPending(() => slow()),
              () => el("b", () => latestOr(() => slow()))
            )
          ]
        )
      );
      const second = boundary(() =>
        Show(
          () => !isPending(() => slow()),
          () => el("span")
        )
      );
      // The two holes of the section's `<div>`, one render effect each.
      createRenderEffect(
        () => unwrap(first),
        a => void (shown.a = a)
      );
      createRenderEffect(
        () => unwrap(second),
        b => void (shown.b = b)
      );
      return d;
    });
    flush();
    for (let t = 0; t < 40; t += 5) {
      await vi.advanceTimersByTimeAsync(5);
      flush();
    }
    expect(screen()).toBe("<p>fast</p><b>slow</b>|<span></span>");
    dispose();
  });
