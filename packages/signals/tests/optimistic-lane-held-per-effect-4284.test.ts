/**
 * #4284: a held optimistic lane holds every render effect that reads it, not
 * only the one that reads its pending work. `latest(guess)` in its own render
 * effect (what compiled JSX gives each `{…}` hole) keeps what it showed while
 * the lane's `derived(5)` is pending, as it does when one effect reads all
 * three (D-25: an on-screen probe in a held lane keeps what it showed).
 */
import { describe, expect, it } from "vitest";
import {
  action,
  createMemo,
  createOptimistic,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  latest
} from "../src/index.js";

const tick = async () => {
  await new Promise(r => setTimeout(r, 0));
  flush();
  await new Promise(r => setTimeout(r, 0));
  flush();
};

function setup(mode: "one" | "two") {
  const flights = new Map<string, { p: Promise<any>; resolve: (v: any) => void }>();
  const ask = (key: string) => {
    if (!flights.has(key)) {
      let resolve!: (v: any) => void;
      const p = new Promise(r => (resolve = r));
      flights.set(key, { p, resolve });
    }
    return flights.get(key)!.p;
  };
  const land = async (key: string, v: unknown) => {
    flights.get(key)!.resolve(v);
    await tick();
  };
  const [truth] = createSignal(1);
  const screen = { a: "", b: "" };
  let attempt!: () => void;
  createRoot(() => {
    const [base] = createSignal(() => truth());
    const [guess, setGuess] = createOptimistic(() => base());
    const derived = createMemo(() => ask("x:" + guess()));
    attempt = action(function* () {
      setGuess(5);
      yield ask("unrelated");
    });
    if (mode === "one")
      createRenderEffect(
        () => `${guess()} ${derived()} / ${latest(guess)}`,
        v => {
          screen.a = v;
        }
      );
    else {
      createRenderEffect(
        () => `${guess()} ${derived()}`,
        v => {
          screen.a = v;
        }
      );
      createRenderEffect(
        () => latest(guess),
        v => {
          screen.b = " / " + String(v);
        }
      );
    }
  });
  flush();
  return { screen, land, attempt: () => attempt() };
}

describe("#4284 a held optimistic lane holds each render effect reading it", () => {
  for (const mode of ["one", "two"] as const) {
    it(`latest(guess) keeps what it showed while the lane is held (${mode} effect(s))`, async () => {
      const { screen, land, attempt } = setup(mode);
      await tick();
      await land("x:1", "x1");
      expect(screen.a + screen.b).toBe("1 x1 / 1");
      attempt();
      flush();
      await tick();
      expect(screen.a + screen.b).toBe("1 x1 / 1");
      await land("x:5", "x5");
      expect(screen.a + screen.b).toBe("5 x5 / 5");
    });
  }
});
