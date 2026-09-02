import { describe, expect, it } from "vitest";
import {
  createMemo,
  createRoot,
  createSignal,
  flush,
  getOwner,
  type SourceAccessor
} from "../src/index.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => (resolve = r));
  return { promise, resolve };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  flush();
}

describe("superseded flight pending-source ownership (#3226)", () => {
  it("retires self and propagated entries before re-parking on another source", async () => {
    const abandoned = deferred<string>();
    const blocker = deferred<string>();
    const [repark, setRepark] = createSignal(false);
    let source!: SourceAccessor<string>;
    let dependent!: SourceAccessor<string>;
    let leaf!: SourceAccessor<string>;
    let sourceNode: any;
    let blockerNode: any;
    let dependentNode: any;
    let leafNode: any;
    let sourceRuns = 0;

    const dispose = createRoot(dispose => {
      const blockingSource = createMemo(() => {
        blockerNode = getOwner();
        return blocker.promise;
      });
      source = createMemo(() => {
        sourceNode = getOwner();
        sourceRuns++;
        return repark() ? blockingSource() : abandoned.promise;
      });
      dependent = createMemo(() => {
        dependentNode = getOwner();
        return source();
      });
      leaf = createMemo(() => {
        leafNode = getOwner();
        return dependent();
      });

      expect(() => leaf()).toThrow();
      return dispose;
    });

    expect(sourceNode._x._pendingSources.has(sourceNode)).toBe(true);
    expect(dependentNode._x._pendingSources.has(sourceNode)).toBe(true);
    expect(leafNode._x._pendingSources.has(sourceNode)).toBe(true);

    setRepark(true);
    flush();

    // The replacement run is now owned by blockingSource. The abandoned
    // flight's self key must be gone from both the source and every propagated
    // dependent before the new source settles.
    expect(sourceRuns).toBe(2);
    expect(sourceNode._x._inFlight).toBeNull();
    expect(sourceNode._x._pendingSources.has(sourceNode)).toBe(false);
    expect(sourceNode._x._pendingSources.has(blockerNode)).toBe(true);
    expect(dependentNode._x._pendingSources.has(sourceNode)).toBe(false);
    expect(dependentNode._x._pendingSources.has(blockerNode)).toBe(true);
    expect(leafNode._x._pendingSources.has(sourceNode)).toBe(false);
    expect(leafNode._x._pendingSources.has(blockerNode)).toBe(true);

    // The retired flight remains stale and cannot disturb the transferred
    // ownership or wake the chain.
    abandoned.resolve("stale");
    await settle();
    expect(sourceRuns).toBe(2);
    expect(sourceNode._x._pendingSources.has(blockerNode)).toBe(true);

    blocker.resolve("ready");
    await settle();

    expect(sourceRuns).toBe(3);
    expect(source()).toBe("ready");
    expect(dependent()).toBe("ready");
    expect(leaf()).toBe("ready");
    expect(sourceNode._x?._pendingSources).toBeUndefined();
    expect(dependentNode._x?._pendingSources).toBeUndefined();
    expect(leafNode._x?._pendingSources).toBeUndefined();
    dispose();
  });

  it("transfers the self entry to a replacement flight until that flight lands", async () => {
    const abandoned = deferred<string>();
    const replacement = deferred<string>();
    const [replace, setReplace] = createSignal(false);
    let source!: SourceAccessor<string>;
    let dependent!: SourceAccessor<string>;
    let sourceNode: any;
    let dependentNode: any;

    const dispose = createRoot(dispose => {
      source = createMemo(() => {
        sourceNode = getOwner();
        return replace() ? replacement.promise : abandoned.promise;
      });
      dependent = createMemo(() => {
        dependentNode = getOwner();
        return source();
      });
      expect(() => dependent()).toThrow();
      return dispose;
    });

    setReplace(true);
    flush();
    expect(sourceNode._x._pendingSources.has(sourceNode)).toBe(true);
    expect(dependentNode._x._pendingSources.has(sourceNode)).toBe(true);

    abandoned.resolve("stale");
    await settle();
    expect(() => dependent()).toThrow();
    expect(sourceNode._x._pendingSources.has(sourceNode)).toBe(true);

    replacement.resolve("fresh");
    await settle();
    expect(source()).toBe("fresh");
    expect(dependent()).toBe("fresh");
    expect(sourceNode._x?._pendingSources).toBeUndefined();
    expect(dependentNode._x?._pendingSources).toBeUndefined();
    dispose();
  });

  it("retires a replacement flight that rejects into another pending source", async () => {
    const abandoned = deferred<string>();
    const blocker = deferred<string>();
    const [repark, setRepark] = createSignal(false);
    let source!: SourceAccessor<string>;
    let dependent!: SourceAccessor<string>;
    let sourceNode: any;
    let blockerNode: any;
    let dependentNode: any;

    const dispose = createRoot(dispose => {
      const blockingSource = createMemo(() => {
        blockerNode = getOwner();
        return blocker.promise;
      });
      source = createMemo(() => {
        sourceNode = getOwner();
        if (!repark()) return abandoned.promise;
        try {
          return Promise.resolve(blockingSource());
        } catch (error) {
          return Promise.reject(error);
        }
      });
      dependent = createMemo(() => {
        dependentNode = getOwner();
        return source();
      });
      expect(() => dependent()).toThrow();
      return dispose;
    });

    setRepark(true);
    flush();
    await Promise.resolve();
    await Promise.resolve();

    expect(sourceNode._x._pendingSources.has(sourceNode)).toBe(false);
    expect(sourceNode._x._pendingSources.has(blockerNode)).toBe(true);
    expect(dependentNode._x._pendingSources.has(sourceNode)).toBe(false);
    expect(dependentNode._x._pendingSources.has(blockerNode)).toBe(true);

    blocker.resolve("ready");
    await settle();
    await settle();
    expect(source()).toBe("ready");
    expect(dependent()).toBe("ready");
    dispose();
  });

  it("keeps the synchronous settle and error paths free of stale entries", () => {
    const abandoned = deferred<string>();
    const [outcome, setOutcome] = createSignal<"pending" | "value" | "error">("pending");
    let source!: SourceAccessor<string>;
    let dependent!: SourceAccessor<string>;
    let sourceNode: any;
    let dependentNode: any;
    const failure = new Error("replacement failed");

    const dispose = createRoot(dispose => {
      source = createMemo(() => {
        sourceNode = getOwner();
        if (outcome() === "value") return "ready";
        if (outcome() === "error") throw failure;
        return abandoned.promise;
      });
      dependent = createMemo(() => {
        dependentNode = getOwner();
        return source();
      });
      expect(() => dependent()).toThrow();
      return dispose;
    });

    setOutcome("value");
    flush();
    expect(source()).toBe("ready");
    expect(dependent()).toBe("ready");
    expect(sourceNode._x?._pendingSources).toBeUndefined();
    expect(dependentNode._x?._pendingSources).toBeUndefined();

    setOutcome("pending");
    flush();
    expect(dependent()).toBe("ready");
    expect(sourceNode._x._pendingSources.has(sourceNode)).toBe(true);
    expect(dependentNode._x._pendingSources.has(sourceNode)).toBe(true);
    setOutcome("error");
    flush();
    expect(() => dependent()).toThrow("replacement failed");
    expect(sourceNode._x?._pendingSources).toBeUndefined();
    expect(dependentNode._x?._pendingSources).toBeUndefined();
    dispose();
  });
});
