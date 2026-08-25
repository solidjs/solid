/**
 * Thrown by a tracked read whose value is currently pending (an async memo /
 * `createSignal(asyncFn)` / projection / store derivation that hasn't settled
 * yet). Surfacing through the reactive graph is what suspends the consumer
 * scope — the nearest enclosing `<Loading>` boundary catches the throw and
 * renders its fallback until the source resolves.
 *
 * App code rarely catches this directly; `<Loading>` is the canonical
 * handler. The error type is exposed for advanced cases — e.g. interop layers
 * that bridge Solid's pending-throw protocol to a different async strategy,
 * or tests that want to assert on the suspension shape.
 *
 * @example
 * ```ts
 * // Advanced: distinguish "not ready yet" from a real error in custom
 * // boundary plumbing. App code should rely on `<Loading>` / `<Errored>`.
 * try {
 *   const value = readReactiveSource();
 * } catch (err) {
 *   if (err instanceof NotReadyError) throw err; // re-throw to suspend
 *   reportError(err);
 * }
 * ```
 */
export class NotReadyError extends Error {
  /**
   * Tags a visibility-only notification on the affects() boundary channel:
   * boundaries update display state from it, but the root queue never
   * registers a reporter — marks are invisible to completion accounting by
   * construction.
   */
  declare _markVisual?: boolean;
  source: any;
  constructor(source: any) {
    // Control-flow throw: it happens on every read of a pending source, so in
    // production skip V8's eager stack capture (proportional to stack depth —
    // real cost under SSR) by zeroing the V8-specific stackTraceLimit around
    // super(). Dev keeps the stack for debuggability; non-V8 engines (no
    // stackTraceLimit) take the plain path.
    const ErrorCtor = Error as unknown as { stackTraceLimit?: number };
    const limit = !__DEV__ ? ErrorCtor.stackTraceLimit : undefined;
    if (limit !== undefined) ErrorCtor.stackTraceLimit = 0;
    super();
    if (limit !== undefined) ErrorCtor.stackTraceLimit = limit;
    this.source = source;
  }
}

export class StatusError extends Error {
  constructor(
    public source: any,
    original: any
  ) {
    super(original instanceof Error ? original.message : String(original), {
      cause: original
    });
  }
}

/** Return the user's error from an internal status wrapper. */
export function unwrapStatusError(error: unknown): unknown {
  return error instanceof StatusError ? error.cause : error;
}

export class NoOwnerError extends Error {
  constructor() {
    super(__DEV__ ? "Context can only be accessed under a reactive root." : "");
  }
}

export class ContextNotFoundError extends Error {
  constructor() {
    super(
      __DEV__
        ? "Context must either be created with a default value or a value must be provided before accessing it."
        : ""
    );
  }
}
