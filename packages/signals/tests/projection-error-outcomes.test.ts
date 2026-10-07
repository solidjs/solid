import { describe, expect, it } from "vitest";
import { createProjection, createSignal, createRoot, createEffect, flush } from "../src/index.js";
const settle = async () => {
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  flush();
};
describe("projection outcome notifications", () => {
  it.each(["sync", "async"])(
    "notifies existing readers of a %s error and same-value recovery",
    async kind => {
      const marker = new Error("projection failed");
      const seen: unknown[] = [];
      const [bad, setBad] = createSignal(false);
      let projected!: { value: number };
      const derive = () => {
        if (bad()) throw marker;
        return { value: 1 };
      };
      const dispose = createRoot(d => {
        projected = createProjection(kind === "sync" ? derive : async () => derive(), { value: 0 });
        createEffect(() => projected.value, {
          effect: value => {
            seen.push(value);
          },
          error: error => {
            seen.push(error);
          }
        });
        return d;
      });
      try {
        flush();
        await settle();
        expect(seen).toEqual([1]);
        setBad(true);
        flush();
        await settle();
        expect(seen).toEqual([1, marker]);
        expect(() => projected.value).toThrow("projection failed");
        setBad(false);
        flush();
        await settle();
        expect(projected.value).toBe(1);
        expect(seen).toEqual([1, marker, 1]);
      } finally {
        dispose();
        flush();
      }
    }
  );
});
