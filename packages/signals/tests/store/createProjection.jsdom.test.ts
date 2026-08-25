/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { createProjection, createRoot, createSignal, flush } from "../../src/index.js";

describe("createProjection in jsdom", () => {
  it("does not loop when a draft is logged", () => {
    const [$value, setValue] = createSignal(0);
    let runs = 0;

    createRoot(() => {
      createProjection(
        draft => {
          runs++;
          if (runs > 5) throw new Error("projection looped");
          console.log(draft);
          draft.value = $value();
        },
        { value: 0 }
      );
    });

    expect(runs).toBe(1);
    setValue(1);
    flush();
    expect(runs).toBe(2);
  });
});
