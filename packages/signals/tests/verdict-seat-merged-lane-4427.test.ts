/**
 * #4427: D-28's verdict-seat reset (#4275, #4284) — a leaf seated as a
 * hold's verdict reader leaves the seat for a lane that is not that hold's
 * — compared verdict lanes by object identity. A transaction merged into
 * the hold keeps its own verdict lane (`verdictLane(t)` is per transaction
 * object; a node stamped before the merge stays in it), and that lane is
 * the same hold's (D-4: holds that merge are one). Read as another hold's,
 * the leaf left the seat and was served the derivation's staging as the
 * hold's own work (L7'): its run waited for the hold's landing while the
 * derivation it read was already on screen — the same value shown two ways
 * on one screen (F-1).
 *
 * Shape: action A holds `x`, `m = memo(latest(x) * 10)` is its verdict
 * lane's; action B holds `y`, and a pass reading both (`k`) merges A into
 * B. A leaf `[latest(y), m()]` mounted under B (born held) is seated as B's
 * verdict reader by `latest(y)`; A's next write re-derives `m`.
 */
import { expect, it } from "vitest";
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
  for (let i = 0; i < 6; i++) await Promise.resolve();
  flush();
};

// `mount`: `held` — `<Show when={y() > 0}>`, the branch B's held pass
// built: the leaf is the hold's own work, born in its world (D-25, D-27),
// so `latest(y)` does not seat it and its runs wait with the frame for B's
// landing, inline as through a memo (held-frame-verdict-parity.test.ts).
// `latest` — `<Show when={latest(y) > 0}>`, a verdict reader's mount
// (mainline, D-27): the leaf is the verdict lanes' work and shows `m` with
// `m`. (Neither shape reaches the D-28 seat comparison any more: a held
// frame's leaf is never seated, and the mainline leaf's lane read enters
// A's lane either way.)
for (const mount of ["latest", "held"] as const)
  it(`a verdict reader seated in a hold reads a merged transaction's verdict lane as that hold's (${mount} mount)`, async () => {
    const [x, setX] = createSignal(0);
    const [y, setY] = createSignal(0);
    let a1!: () => void, a2!: () => void, b1!: () => void, b2!: () => void;
    const actA = action(function* () {
      setX(1);
      yield new Promise<void>(r => (a1 = r));
      setX(2);
      yield new Promise<void>(r => (a2 = r));
    });
    const actB = action(function* () {
      setY(1);
      yield new Promise<void>(r => (b1 = r));
      setY(2);
      yield new Promise<void>(r => (b2 = r));
    });
    let shownM: unknown, leaf: unknown;
    createRoot(() => {
      const m = createMemo(() => latest(x) * 10);
      const k = createMemo(() => x() + y());
      createRenderEffect(x, () => {});
      createRenderEffect(y, () => {});
      createRenderEffect(m, v => {
        shownM = v;
      });
      createRenderEffect(k, () => {});
      // <Show when={latest(y) > 0 | y() > 0}>{[latest(y), m()]}</Show>
      const when = createMemo(() => (mount === "latest" ? latest(y) : y()) > 0);
      const content = createMemo(() => {
        if (!when()) return "off";
        createRenderEffect(
          () => `${latest(y)}/${m()}`,
          v => {
            leaf = v;
          }
        );
        return "on";
      });
      createRenderEffect(content, () => {});
    });
    flush();
    actA();
    await tick();
    expect(shownM).toBe(10);
    actB();
    await tick();
    expect(leaf).toBe("1/10");

    // A's next step re-derives `m` in its (merged) verdict lane: the seated
    // leaf shows it with `m`, not at B's landing; the held frame's waits.
    a1();
    await tick();
    await tick();
    expect(shownM).toBe(20);
    expect(leaf).toBe(mount === "latest" ? "1/20" : "1/10");

    b1();
    await tick();
    await tick();
    expect(leaf).toBe(mount === "latest" ? "2/20" : "1/10");
    b2();
    a2();
    await tick();
    await tick();
    expect([shownM, leaf]).toEqual([20, "2/20"]);
  });
