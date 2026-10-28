/**
 * #4340: #4203's fix kept a nested first pass left pending from joining a
 * verdict mount's staged read, but only when it read the staging itself. A
 * memo that read it through another memo (`gate`) still joined through that
 * memo and held the boundary forever, though nothing reads it. A pending
 * value no render effect reaches holds nothing and reaches no boundary
 * (Reader), at any depth. A render effect that does read it is still held.
 */
import { describe, expect, it } from "vitest";
import {
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  latest,
  untrack
} from "../src/index.js";

const settle = async () => {
  for (let i = 0; i < 3; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

function mount(content: () => unknown) {
  let slot: unknown;
  createRoot(() => {
    const value = createMemo(async () => "x");
    const outer = createLoadingBoundary(
      () => {
        // <Show when={latest(value) ?? value()} keyed>
        const when = createMemo(() => latest(value) ?? value());
        const children = createMemo(() =>
          when() ? untrack(() => createLoadingBoundary(content, () => "INNER LOADING")) : undefined
        );
        return () => {
          const c = children();
          return typeof c === "function" ? c() : c;
        };
      },
      () => "OUTER LOADING"
    );
    createRenderEffect(
      () => {
        let v: any = outer();
        while (typeof v === "function") v = v();
        return v;
      },
      v => {
        slot = v;
      }
    );
  });
  return () => slot;
}

describe("#4340: an unread pending memo behind memos does not hold a verdict-mounted boundary", () => {
  for (const depth of [1, 2, 3]) {
    it(`reveals with ${depth} intermediate memo(s)`, async () => {
      const slot = mount(() => {
        const [version, setVersion] = createSignal(0, { ownedWrite: true });
        setVersion(1);
        let gate: () => unknown = version;
        for (let i = 0; i < depth; i++) {
          const prev = gate;
          gate = createMemo(() => prev());
        }
        // Never read; never settles.
        createMemo(() => (gate(), new Promise(() => {})));
        return "CHILD";
      });
      flush();
      await settle();
      expect(slot()).toBe("CHILD");
    });
  }

  it("a render effect that reads the pending memo still holds the boundary", async () => {
    const slot = mount(() => {
      const [version, setVersion] = createSignal(0, { ownedWrite: true });
      setVersion(1);
      const gate = createMemo(() => version());
      const pending = createMemo(() => (gate(), new Promise(() => {})));
      createRenderEffect(pending, () => {});
      return "CHILD";
    });
    flush();
    await settle();
    expect(slot()).toBe("INNER LOADING");
  });
});
