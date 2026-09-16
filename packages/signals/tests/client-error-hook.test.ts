/**
 * The client error hook (the Sentry plan's client twin of the server error hook):
 * `configureClientErrors({ onError })` and a root's own hook under
 * `ROOT_ERROR_HOOK` hear the one failure nothing else sees — an error
 * boundary rendering its fallback — once per error object, with the owner
 * path where the runtime keeps labels. The nearest root's hook wins over the
 * ambient one; a throwing hook is reported and ignored. An uncaught error is
 * not this hook's: the halt reaches `reportError` (errorHalt.test.ts).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ROOT_ERROR_HOOK,
  configureClientErrors,
  createErrorBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  getOwner,
  resetErrorHalt,
  type ClientErrorContext
} from "../src/index.js";

type Call = { error: unknown; context: ClientErrorContext };

afterEach(() => {
  configureClientErrors({ onError: undefined });
  resetErrorHalt();
  vi.restoreAllMocks();
});

function hook(calls: Call[]) {
  return (error: unknown, context: ClientErrorContext) => {
    calls.push({ error, context });
  };
}

/** A boundary over a memo that throws while `fail()` is set; returns the rendered value's reader. */
function boundaryOver(fail: () => boolean, boom: () => unknown) {
  let result: unknown;
  let reset!: () => void;
  createRoot(() => {
    const memo = createMemo(() => {
      if (fail()) throw boom();
      return "content";
    });
    const b = createErrorBoundary(
      () => memo(),
      (_err, r) => {
        reset = r;
        return "fallback";
      }
    );
    createRenderEffect(
      () => (result = b()),
      () => {}
    );
  });
  flush();
  return { value: () => result, reset: () => reset() };
}

describe("caught", () => {
  it("a boundary rendering its fallback reports the error once, with what it caught", () => {
    const calls: Call[] = [];
    configureClientErrors({ onError: hook(calls) });
    const boom = new Error("boom");
    const [fail, setFail] = createSignal(false);
    const view = boundaryOver(fail, () => boom);
    expect(view.value()).toBe("content");
    expect(calls).toHaveLength(0);

    setFail(true);
    flush();
    expect(view.value()).toBe("fallback");
    expect(calls).toHaveLength(1);
    expect(calls[0].error).toBe(boom);
    expect(calls[0].context).toEqual({});
  });

  it("a reset that recomputes the same failure says nothing new; a different error is a new report", () => {
    const calls: Call[] = [];
    configureClientErrors({ onError: hook(calls) });
    let boom: unknown = new Error("first");
    const [fail, setFail] = createSignal(true);
    const view = boundaryOver(fail, () => boom);
    // The memo is created throwing: caught at creation.
    expect(view.value()).toBe("fallback");
    expect(calls).toHaveLength(1);

    view.reset();
    flush();
    expect(view.value()).toBe("fallback");
    expect(calls).toHaveLength(1);

    // A new object is a new failure.
    setFail(false);
    flush();
    expect(view.value()).toBe("content");
    setFail(true);
    flush();
    expect(calls).toHaveLength(1); // the same `boom` object again
    setFail(false);
    flush();
    boom = new Error("second");
    setFail(true);
    flush();
    expect(calls).toHaveLength(2);
    expect((calls[1].error as Error).message).toBe("second");
  });

  it("a primitive thrown has no identity and is reported per sight", () => {
    const calls: Call[] = [];
    configureClientErrors({ onError: hook(calls) });
    const [fail, setFail] = createSignal(true);
    const view = boundaryOver(fail, () => "token abc");
    expect(calls).toHaveLength(1);
    view.reset();
    flush();
    expect(calls).toHaveLength(2);
    expect(calls[1].error).toBe("token abc");
  });

  it("carries the owner path where owners are labelled", () => {
    const calls: Call[] = [];
    configureClientErrors({ onError: hook(calls) });
    let result: unknown;
    createRoot(() => {
      // A labelled owner the way a component owner is (`_name`), then the
      // boundary under it.
      const owner = getOwner()! as any;
      owner._name = "<App>";
      const b = createErrorBoundary(
        () => {
          throw new Error("boom");
        },
        () => "fallback"
      );
      createRenderEffect(
        () => (result = b()),
        () => {}
      );
    });
    flush();
    expect(result).toBe("fallback");
    expect(calls).toHaveLength(1);
    expect(calls[0].context.ownerPath).toEqual(["<App>"]);
  });
});

describe("two tiers", () => {
  it("a root's own hook (under ROOT_ERROR_HOOK) wins over the ambient one for failures under it", () => {
    const ambient: Call[] = [];
    const mine: Call[] = [];
    configureClientErrors({ onError: hook(ambient) });
    let result: unknown;
    createRoot(() => {
      (getOwner() as any)[ROOT_ERROR_HOOK] = hook(mine);
      const b = createErrorBoundary(
        () => {
          throw new Error("boom");
        },
        () => "fallback"
      );
      createRenderEffect(
        () => (result = b()),
        () => {}
      );
    });
    flush();
    expect(result).toBe("fallback");
    expect(mine).toHaveLength(1);
    expect(ambient).toHaveLength(0);
  });

  it("a throwing hook is reported on the console; the boundary still renders", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    configureClientErrors({
      onError: () => {
        throw new Error("hook broke");
      }
    });
    const [fail] = createSignal(true);
    const boom = new Error("boom");
    const view = boundaryOver(fail, () => boom);
    expect(view.value()).toBe("fallback");
    expect(error.mock.calls.some(args => String(args[0]).includes("hook broke"))).toBe(true);
  });

  it("refuses a non-function", () => {
    expect(() => configureClientErrors({ onError: 42 as any })).toThrow(TypeError);
  });
});
