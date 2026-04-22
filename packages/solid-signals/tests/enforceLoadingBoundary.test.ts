import {
  createErrorBoundary,
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  enforceLoadingBoundary,
  flush
} from "../src/index.js";

describe("enforceLoadingBoundary", () => {
  let warnSpy!: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    enforceLoadingBoundary(false);
    flush();
  });

  it("warns when async pending propagates to root without a boundary", () => {
    enforceLoadingBoundary(true);

    expect(() => {
      createRoot(() => {
        const value = createMemo(() => new Promise<string>(() => {}));
        createRenderEffect(value, () => {});
      });
    }).not.toThrow();

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Loading boundary"));
  });

  it("does not warn when createLoadingBoundary catches the pending", () => {
    enforceLoadingBoundary(true);

    expect(() => {
      createRoot(() => {
        const value = createMemo(() => new Promise<string>(() => {}));
        const boundary = createLoadingBoundary(value, () => "loading");
        createRenderEffect(boundary, () => {});
      });
    }).not.toThrow();

    expect(warnSpy).not.toHaveBeenCalled();
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
          err => {
            caughtError = err;
          }
        );
      });
    }).not.toThrow();

    expect(caughtError).toBeDefined();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("does not warn when disabled", () => {
    enforceLoadingBoundary(false);

    expect(() => {
      createRoot(() => {
        const value = createMemo(() => new Promise<string>(() => {}));
        createRenderEffect(value, () => {});
      });
    }).not.toThrow();

    expect(warnSpy).not.toHaveBeenCalled();
  });
});
