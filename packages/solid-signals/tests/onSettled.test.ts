import { createMemo, createRoot, createSignal, flush, onSettled } from "../src/index.js";

afterEach(() => flush());

it("should run callback after flush", () => {
  const log: string[] = [];

  createRoot(() => {
    log.push("sync");
    onSettled(() => {
      log.push("settled");
    });
    log.push("after onSettled call");
  });

  expect(log).toEqual(["sync", "after onSettled call"]);
  flush();
  expect(log).toEqual(["sync", "after onSettled call", "settled"]);
});

it("should run without owner", () => {
  const log: string[] = [];

  onSettled(() => {
    log.push("settled");
  });

  expect(log).toEqual([]);
  flush();
  expect(log).toEqual(["settled"]);
});

it("should call cleanup when disposed", () => {
  const cleanup = vi.fn();

  const dispose = createRoot(d => {
    onSettled(() => cleanup);
    return d;
  });

  flush();
  expect(cleanup).toHaveBeenCalledTimes(0);

  dispose();
  expect(cleanup).toHaveBeenCalledTimes(1);
});

it("should call cleanup immediately when no owner", () => {
  const cleanup = vi.fn();

  onSettled(() => cleanup);

  expect(cleanup).toHaveBeenCalledTimes(0);
  flush();
  expect(cleanup).toHaveBeenCalledTimes(1);
});

it("should wait for async to settle before running", async () => {
  const log: string[] = [];
  let resolve: (v: string) => void;
  const promise = new Promise<string>(r => (resolve = r));

  createRoot(() => {
    const $async = createMemo(async () => {
      return await promise;
    });

    // onSettled waits for async to settle - doesn't run while pending
    onSettled(() => {
      log.push("settled: " + $async());
    });
  });

  flush();
  // Callback doesn't run while async is pending
  expect(log).toEqual([]);

  resolve!("resolved");
  await new Promise(r => setTimeout(r, 10));
  flush();
  // Now it runs with the resolved value
  expect(log).toContain("settled: resolved");
});

it("should not track normal signal reads", () => {
  const [$x, setX] = createSignal(0);
  const log: number[] = [];

  createRoot(() => {
    onSettled(() => {
      log.push($x());
    });
  });

  flush();
  expect(log).toEqual([0]);

  // Changing the signal should NOT trigger onSettled again
  setX(1);
  flush();
  expect(log).toEqual([0]);
});

it("should call cleanup on re-run after async settles", async () => {
  const cleanup = vi.fn();
  const effect = vi.fn();
  let resolve: (v: string) => void;
  const promise = new Promise<string>(r => (resolve = r));

  createRoot(() => {
    const $async = createMemo(async () => {
      return await promise;
    });

    onSettled(() => {
      effect($async());
      return cleanup;
    });
  });

  flush();
  // First run aborts due to pending async
  expect(effect).toHaveBeenCalledTimes(0);
  expect(cleanup).toHaveBeenCalledTimes(0);

  resolve!("done");
  await new Promise(r => setTimeout(r, 10));
  flush();
  // Now callback runs
  expect(effect).toHaveBeenCalledWith("done");
});
