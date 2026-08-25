import { createReaction, createRoot, createSignal, flush, resetErrorHalt } from "../src/index.js";

describe("createReaction", () => {
  test("Create and trigger a Reaction", () => {
    let count = 0;
    const [sign, setSign] = createSignal("thoughts");
    const track = createRoot(() =>
      createReaction(() => {
        count++;
      })
    );
    flush();
    expect(count).toBe(0);
    track(sign);
    expect(count).toBe(0);
    flush();
    expect(count).toBe(0);
    setSign("mind");
    flush();
    expect(count).toBe(1);
    setSign("body");
    flush();
    expect(count).toBe(1);
    track(sign);
    setSign("everything");
    flush();
    expect(count).toBe(2);
  });

  test("fires and disposes cleanly when the rerun tracks zero dependencies", () => {
    let fired = 0;
    let readDep = true;
    const [sign, setSign] = createSignal("a");
    createRoot(() => {
      const track = createReaction(() => {
        fired++;
      });
      track(() => {
        // initial run reads a dep; the invalidating rerun reads none
        if (readDep) sign();
      });
    });
    flush();
    expect(fired).toBe(0);

    readDep = false;
    setSign("b");
    expect(() => flush()).not.toThrow();
    expect(fired).toBe(1);
  });

  /**
   * #2861: 1.x replacement semantics — each `track()` call replaces the
   * previous tracked sources. Re-arming before the reaction fired used to
   * leave the superseded arm alive: its sources still fired the callback,
   * each accumulated arm delivered its own fire, and un-fired arms leaked
   * as live effect nodes until they eventually fired or the owner disposed.
   */
  test("re-arming before a fire replaces tracked sources (#2861)", () => {
    let count = 0;
    const [a, setA] = createSignal(0);
    const [b, setB] = createSignal(0);
    const track = createRoot(() =>
      createReaction(() => {
        count++;
      })
    );

    track(() => a());
    track(() => b()); // supersedes the a() arm before any fire

    setA(1);
    flush();
    expect(count).toBe(0); // superseded arm must not fire

    setB(1);
    flush();
    expect(count).toBe(1);

    // Disarmed after the fire — nothing accumulated.
    setB(2);
    setA(2);
    flush();
    expect(count).toBe(1);
  });

  test("re-arm inside the reaction callback arms the next cycle (#2861)", () => {
    let count = 0;
    const [a, setA] = createSignal(0);
    let track!: (fn: () => void) => void;
    createRoot(() => {
      track = createReaction(() => {
        count++;
        track(() => a());
      });
    });

    track(() => a());
    setA(1);
    flush();
    expect(count).toBe(1);

    setA(2);
    flush();
    expect(count).toBe(2);
  });

  test("throws on invalid cleanup values", () => {
    const [sign, setSign] = createSignal("thoughts");
    const track = createRoot(() =>
      createReaction(() => {
        return 123 as any;
      })
    );

    track(sign);
    setSign("mind");
    expect(() => flush()).toThrow(
      "Reaction callback returned an invalid cleanup value. Return a cleanup function or undefined."
    );
    resetErrorHalt();
  });
});
