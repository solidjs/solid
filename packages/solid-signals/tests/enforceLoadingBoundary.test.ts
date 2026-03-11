import {
  createErrorBoundary,
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  enforceLoadingBoundary,
  flush
} from "../src/index.js";

afterEach(() => {
  enforceLoadingBoundary(false);
  flush();
});

describe("enforceLoadingBoundary", () => {
  it("throws when async pending propagates to root without a boundary", () => {
    enforceLoadingBoundary(true);

    expect(() => {
      createRoot(() => {
        const value = createMemo(() => new Promise<string>(() => {}));
        createRenderEffect(value, () => {});
      });
    }).toThrow("Loading boundary");
  });

  it("does not throw when createLoadingBoundary catches the pending", () => {
    enforceLoadingBoundary(true);

    expect(() => {
      createRoot(() => {
        const value = createMemo(() => new Promise<string>(() => {}));
        const boundary = createLoadingBoundary(value, () => "loading");
        createRenderEffect(boundary, () => {});
      });
    }).not.toThrow();
  });

  it("error is caught by createErrorBoundary when no load boundary", () => {
    enforceLoadingBoundary(true);
    let caughtError: unknown;

    expect(() => {
      createRoot(() => {
        createErrorBoundary(
          () => {
            const value = createMemo(() => new Promise<string>(() => {}));
            createRenderEffect(value, () => {});
          },
          (err) => {
            caughtError = err;
          }
        );
      });
    }).not.toThrow();

    expect(caughtError).toBeDefined();
  });

  it("does not throw when disabled", () => {
    enforceLoadingBoundary(false);

    expect(() => {
      createRoot(() => {
        const value = createMemo(() => new Promise<string>(() => {}));
        createRenderEffect(value, () => {});
      });
    }).not.toThrow();
  });
});
