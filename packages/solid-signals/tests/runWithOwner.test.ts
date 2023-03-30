import { catchError, createRoot, getOwner, runWithOwner } from "../src";
import { Owner } from "../src/types";

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
  catchError(() => {
    owner = getOwner();
  }, handler);

  runWithOwner(owner, () => {
    throw error;
  });

  expect(handler).toHaveBeenCalledWith(error);
});
