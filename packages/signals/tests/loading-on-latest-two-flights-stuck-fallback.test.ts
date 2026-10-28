// Found while fixing #4367 (pre-existing on next @ 5f60713a).
//
// A Loading armed by `on: () => latest(id)` shares `id` with a second
// boundary; each reads its own async memo of `id`. `setId(1)` shows the
// armed boundary's fallback (D-17). The armed flight lands first while the
// other still holds the frame: the output's pass leaves the verdict lane
// inside the held transaction's flush, so lanes.ts `laneStage` does not set
// LEFT_SHOWN (the frame is still blocked) and clears the node's lane
// transaction — and the answer equals the committed value the equality gate
// compared it with (the same content), so nobody was told. When the second
// flight landed, nothing woke the reader: the screen stayed on the fallback
// for good ("fallback|2" instead of "2|2"). The fallback the screen shows is
// the node's `_value` now: the answer is a change, staged with the frame.
import { expect, test } from "vitest";
import {
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  latest
} from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  flush();
};

test.each(["armed first", "plain first"] as const)(
  "Loading on latest over two flights leaves its fallback once both land (%s)",
  async order => {
    let finishA!: (v: number) => void;
    let finishB!: (v: number) => void;
    const pa = new Promise<number>(r => (finishA = r));
    const pb = new Promise<number>(r => (finishB = r));
    const [id, setId] = createSignal(0);
    const texts: string[] = [];
    let appliedA: unknown;
    let appliedB: unknown;
    createRoot(() => {
      const dataA = createMemo(() => (id() ? pa : Promise.resolve(1)));
      const dataB = createMemo(() => (id() ? pb : Promise.resolve(1)));
      const slot = (data: () => number, fallback: string, on?: boolean) => {
        const i = texts.push("") - 1;
        return createLoadingBoundary(
          () => {
            createRenderEffect(
              () => data(),
              v => {
                texts[i] = String(v);
              }
            );
            return i;
          },
          () => fallback,
          on ? { on: () => latest(id) } : undefined
        );
      };
      const armed = slot(dataA, "fallback", true);
      const plain = slot(dataB, "kept");
      createRenderEffect(armed, v => {
        appliedA = v;
      });
      createRenderEffect(plain, v => {
        appliedB = v;
      });
    });
    const screen = () =>
      (typeof appliedA === "number" ? texts[appliedA] : String(appliedA)) +
      "|" +
      (typeof appliedB === "number" ? texts[appliedB] : String(appliedB));
    flush();
    await tick();
    expect(screen()).toBe("1|1");
    setId(1);
    flush();
    await tick();
    expect(screen()).toBe("fallback|1");
    if (order === "armed first") {
      finishA(2);
      await tick();
      // The frame still waits on the plain boundary's flight: the armed
      // boundary's content lands with it.
      expect(screen()).toBe("fallback|1");
      finishB(2);
    } else {
      // The frame waited on the plain boundary's flight alone (the armed
      // boundary collected its reader): it lands, the fallback stays.
      finishB(2);
      await tick();
      expect(screen()).toBe("fallback|2");
      finishA(2);
    }
    await tick();
    expect(screen()).toBe("2|2"); // next, armed first: "fallback|2"
  }
);
