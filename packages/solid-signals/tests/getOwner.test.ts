import { createEffect, createRoot, getOwner, untrack } from "../src";

it("should return current owner", () => {
  createRoot(() => {
    const owner = getOwner();
    expect(owner).toBeDefined();
    createEffect(() => {
      expect(getOwner()).toBeDefined();
      expect(getOwner()).not.toBe(owner);
    });
  });
});

it("should return parent scope from inside untrack", () => {
  createRoot(() => {
    untrack(() => {
      expect(getOwner()).toBeDefined();
    });
  });
});
