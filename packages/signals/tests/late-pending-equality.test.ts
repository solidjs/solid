import { expect, it } from "vitest";
import {
  createEffect,
  createMemo,
  createProjection,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  onCleanup,
  untrack
} from "../src/index.js";

it("commits an effect write when a pending source is superseded with its cached value", async () => {
  const gate = Promise.withResolvers<number>();
  let flight: Promise<number> | undefined = gate.promise;
  let notify = () => {};
  let mount!: () => void;
  let readDerived!: () => number;
  let direct = -1;
  let displayedDerived = -1;
  const applied: number[] = [];
  const dispose = createRoot(dispose => {
    const [mounted, setMounted] = createSignal(false);
    mount = () => setMounted(true);
    createMemo(() => {
      if (!mounted()) {
        // Disposing the previous branch invalidates the new reader after
        // its first cached read, making it observe the pending flight.
        onCleanup(() => notify());
        return;
      }
      const [version, setVersion] = createSignal(0, { ownedWrite: true });
      notify = () => setVersion(value => value + 1);
      const data = createMemo(previous => {
        version();
        return flight && previous !== undefined ? flight : 1;
      });
      const [derived, setDerived] = createSignal(0);
      readDerived = () => untrack(derived);
      createEffect(data, value => {
        applied.push(value);
        setDerived(value);
      });
      createRenderEffect(data, value => {
        direct = value;
      });
      createRenderEffect(derived, value => {
        displayedDerived = value;
      });
    });
    return dispose;
  });
  try {
    flush();
    mount();
    flush();
    expect(applied).toEqual([1]);
    expect(readDerived()).toBe(0);
    expect(displayedDerived).toBe(0);
    flight = undefined;
    notify();
    flush();
    // Superseding the flight releases the write without waiting for its
    // abandoned promise to resolve.
    expect(applied).toEqual([1]);
    expect(direct).toBe(1);
    expect(readDerived()).toBe(1);
    expect(displayedDerived).toBe(1);
    gate.resolve(1);
    await Promise.resolve();
    await Promise.resolve();
    flush();
    expect(applied).toEqual([1]);
    expect(direct).toBe(1);
    expect(readDerived()).toBe(1);
    expect(displayedDerived).toBe(1);
  } finally {
    dispose();
    flush();
  }
});

it("wakes a late reader when a conditional drops a pending source with an equal value", async () => {
  const gate = Promise.withResolvers<{ enabled: boolean }>();
  let start!: () => void;
  let reveal!: () => void;
  let setVirtual!: (v: boolean) => void;
  let dispose!: () => void;
  const values: unknown[] = [];
  createRoot(d => {
    dispose = d;
    const [request, setRequest] = createSignal(false);
    const [virtual, writeVirtual] = createSignal(false);
    setVirtual = writeVirtual;
    const [shown, setShown] = createSignal(false);
    const data = createProjection(() => (request() ? gate.promise : { enabled: false }), {
      enabled: false
    });
    const enabled = createMemo(() => !virtual() && data.enabled);
    const handler = createMemo(() => (enabled() ? "handler" : undefined));
    const attributes = createMemo(() => ({ handler: handler() }));
    createRenderEffect(handler, () => {});
    createRenderEffect(
      () => (shown() ? attributes() : null),
      value => {
        values.push(value);
      }
    );
    start = () => setRequest(true);
    reveal = () => setShown(true);
  });
  flush();
  try {
    start();
    flush();
    reveal();
    flush();
    setVirtual(true);
    flush();
    expect(values).toEqual([null, { handler: undefined }]);
    gate.resolve({ enabled: false });
    await new Promise(resolve => setTimeout(resolve, 0));
    flush();
    expect(values).toEqual([null, { handler: undefined }]);
  } finally {
    gate.resolve({ enabled: false });
    dispose();
    flush();
  }
});

it("does not rerun an unchanged dependent that only inherited pending status", async () => {
  const gate = Promise.withResolvers<{ enabled: boolean }>();
  let start!: () => void;
  let stop!: () => void;
  let dispose!: () => void;
  let computes = 0;
  const values: unknown[] = [];
  createRoot(d => {
    dispose = d;
    const [request, setRequest] = createSignal(false);
    const [virtual, setVirtual] = createSignal(false);
    const data = createProjection(() => (request() ? gate.promise : { enabled: false }), {
      enabled: false
    });
    const enabled = createMemo(() => !virtual() && data.enabled);
    const attributes = createMemo(() => {
      const value = enabled();
      computes++;
      return { enabled: value };
    });
    createRenderEffect(attributes, value => {
      values.push(value);
    });
    start = () => setRequest(true);
    stop = () => setVirtual(true);
  });
  flush();
  try {
    start();
    flush();
    stop();
    flush();
    gate.resolve({ enabled: false });
    await new Promise(resolve => setTimeout(resolve, 0));
    flush();
    expect(computes).toBe(1);
    expect(values).toEqual([{ enabled: false }]);
  } finally {
    gate.resolve({ enabled: false });
    dispose();
    flush();
  }
});

it.each([false, true])(
  "keeps a dependent pending through another path (indirect: %s)",
  async indirect => {
    const gate = Promise.withResolvers<{ enabled: boolean }>();
    let start!: () => void;
    let stop!: () => void;
    let dispose!: () => void;
    let pending!: () => boolean;
    const values: unknown[] = [];
    createRoot(d => {
      dispose = d;
      const [request, setRequest] = createSignal(false);
      const [virtual, setVirtual] = createSignal(false);
      const data = createProjection(() => (request() ? gate.promise : { enabled: false }), {
        enabled: false
      });
      const enabled = createMemo(() => !virtual() && data.enabled);
      const other = indirect ? createMemo(() => data.enabled) : () => data.enabled;
      const combined = createMemo(() => ({ conditional: enabled(), direct: other() }));
      pending = createMemo(() => isPending(combined));
      createRenderEffect(combined, value => {
        values.push(value);
      });
      createRenderEffect(pending, () => {});
      start = () => setRequest(true);
      stop = () => setVirtual(true);
    });
    flush();
    try {
      start();
      flush();
      expect(pending()).toBe(true);
      stop();
      flush();
      expect(pending()).toBe(true);
      expect(values).toEqual([{ conditional: false, direct: false }]);
      gate.resolve({ enabled: true });
      await new Promise(resolve => setTimeout(resolve, 0));
      flush();
      expect(pending()).toBe(false);
      expect(values.at(-1)).toEqual({ conditional: false, direct: true });
    } finally {
      gate.resolve({ enabled: true });
      dispose();
      flush();
    }
  }
);

it.each([2, 3])("settles a branch immediately after it drops %i pending sources", async count => {
  const gates = Array.from({ length: count }, () => Promise.withResolvers<{ enabled: boolean }>());
  let start!: () => void;
  let stop!: () => void;
  let reveal!: () => void;
  let pending!: () => boolean;
  let dispose!: () => void;
  const values: unknown[] = [];
  createRoot(d => {
    dispose = d;
    const [request, setRequest] = createSignal(false);
    const [virtual, setVirtual] = createSignal(false);
    const [shown, setShown] = createSignal(false);
    const data = gates.map(gate =>
      createProjection(() => (request() ? gate.promise : { enabled: false }), { enabled: false })
    );
    const enabled = createMemo(() => !virtual() && data.map(value => value.enabled).some(Boolean));
    const handler = createMemo(() => (enabled() ? "handler" : undefined));
    const attributes = createMemo(() => ({ handler: handler() }));
    pending = createMemo(() => isPending(handler));
    createRenderEffect(handler, () => {});
    createRenderEffect(pending, () => {});
    createRenderEffect(
      () => (shown() ? attributes() : null),
      value => {
        values.push(value);
      }
    );
    start = () => setRequest(true);
    stop = () => setVirtual(true);
    reveal = () => setShown(true);
  });
  flush();
  try {
    start();
    flush();
    reveal();
    flush();
    expect(pending()).toBe(true);
    stop();
    flush();
    expect(pending()).toBe(false);
    expect(values).toEqual([null, { handler: undefined }]);
    for (const gate of gates) gate.resolve({ enabled: true });
    await new Promise(resolve => setTimeout(resolve, 0));
    flush();
    expect(pending()).toBe(false);
    expect(values).toEqual([null, { handler: undefined }]);
  } finally {
    for (const gate of gates) gate.resolve({ enabled: true });
    await new Promise(resolve => setTimeout(resolve, 0));
    dispose();
    flush();
  }
});

it("settles converging unchanged branches before their shared source resolves", async () => {
  const gate = Promise.withResolvers<{ enabled: boolean }>();
  let start!: () => void;
  let stop!: () => void;
  let reveal!: () => void;
  let pending!: () => boolean;
  let dispose!: () => void;
  const values: unknown[] = [];
  createRoot(d => {
    dispose = d;
    const [request, setRequest] = createSignal(false);
    const [virtual, setVirtual] = createSignal(false);
    const [shown, setShown] = createSignal(false);
    const data = createProjection(() => (request() ? gate.promise : { enabled: false }), {
      enabled: false
    });
    const enabled = createMemo(() => !virtual() && data.enabled);
    const left = createMemo(() => enabled());
    const right = createMemo(() => enabled());
    const combined = createMemo(() => ({ left: left(), right: right() }));
    pending = createMemo(() => isPending(combined));
    createRenderEffect(combined, () => {});
    createRenderEffect(pending, () => {});
    createRenderEffect(
      () => (shown() ? combined() : null),
      value => {
        values.push(value);
      }
    );
    start = () => setRequest(true);
    stop = () => setVirtual(true);
    reveal = () => setShown(true);
  });
  flush();
  try {
    start();
    flush();
    reveal();
    flush();
    expect(pending()).toBe(true);
    expect(values).toEqual([null]);
    stop();
    flush();
    expect(pending()).toBe(false);
    expect(values).toEqual([null, { left: false, right: false }]);
    gate.resolve({ enabled: true });
    await new Promise(resolve => setTimeout(resolve, 0));
    flush();
    expect(values).toEqual([null, { left: false, right: false }]);
  } finally {
    gate.resolve({ enabled: true });
    dispose();
    flush();
  }
});
