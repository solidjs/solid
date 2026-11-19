import { describe, expect, it } from "vitest";
import { createMemo, createRenderEffect, createRoot, flush, latest } from "../src/index.js";

const wait = <T>(value: T) => new Promise<T>(resolve => setTimeout(() => resolve(value), 5));

describe("#5073 latest() loading flag over a chained async memo", () => {
  it("leaves the loading state once both requests have resolved", async () => {
    let spinner: boolean | undefined;
    let content: string | undefined;
    const dispose = createRoot(dispose => {
      const first = createMemo(() => wait("a"), { loadingValue: undefined });
      const id = createMemo(() => first());
      const second = createMemo(() => (id() ? wait(id()) : undefined));
      const loading = () => !latest(first) || (id() !== undefined && !latest(second));
      const view = createMemo(() => {
        if (loading() || !latest(second)) return undefined;
        const row = createMemo(() => latest(second));
        createRenderEffect(
          () => row(),
          () => {}
        );
        return "content";
      });
      createRenderEffect(
        () => loading(),
        value => {
          spinner = value;
        }
      );
      createRenderEffect(
        () => view(),
        value => {
          content = value;
        }
      );
      return dispose;
    });
    flush();
    await new Promise(resolve => setTimeout(resolve, 100));
    expect({ spinner, content }).toEqual({ spinner: false, content: "content" });
    dispose();
  });
});
