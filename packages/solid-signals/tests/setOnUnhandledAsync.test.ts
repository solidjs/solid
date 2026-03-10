import {
  createLoadBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  flush,
  setOnUnhandledAsync
} from "../src/index.js";

afterEach(() => {
  setOnUnhandledAsync(null);
  flush();
});

describe("setOnUnhandledAsync", () => {
  it("fires when async pending propagates to root without a boundary", () => {
    const callback = vi.fn();
    setOnUnhandledAsync(callback);

    createRoot(() => {
      const value = createMemo(() => new Promise<string>(() => {}));
      createRenderEffect(value, () => {});
    });

    flush();
    expect(callback).toHaveBeenCalled();
  });

  it("does not fire when createLoadBoundary catches the pending", () => {
    const callback = vi.fn();
    setOnUnhandledAsync(callback);

    createRoot(() => {
      const value = createMemo(() => new Promise<string>(() => {}));
      const boundary = createLoadBoundary(value, () => "loading");
      createRenderEffect(boundary, () => {});
    });

    flush();
    expect(callback).not.toHaveBeenCalled();
  });

  it("does not crash when set to null", () => {
    setOnUnhandledAsync(null);

    createRoot(() => {
      const value = createMemo(() => new Promise<string>(() => {}));
      createRenderEffect(value, () => {});
    });

    expect(() => flush()).not.toThrow();
  });
});
