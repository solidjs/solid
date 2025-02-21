import {
  createRenderEffect,
  createErrorBoundary,
  createRoot,
  flushSync,
  getOwner,
  Owner,
  runWithOwner
} from "../src/index.js";

it("should scope function to current scope", () => {
  let owner!: Owner | null;

  createRoot(() => {
    owner = getOwner()!;
    owner._context = { foo: 1 };
  });

  runWithOwner(owner, () => {
    expect(getOwner()!._context?.foo).toBe(1);
  });
});

it("should return value", () => {
  expect(runWithOwner(null, () => 100)).toBe(100);
});

it("should handle errors", () => {
  const error = new Error(),
    handler = vi.fn();

  let owner!: Owner | null;
  const b = createErrorBoundary(
    () => {
      owner = getOwner();
    },
    err => handler(err)
  );
  b();

  runWithOwner(owner, () => {
    createRenderEffect(
      () => {
        throw error;
      },
      () => {}
    );
  });

  b();
  flushSync();
  expect(handler).toHaveBeenCalledWith(error);
});
