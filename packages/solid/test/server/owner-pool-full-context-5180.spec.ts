/** @vitest-environment node */
import { expect, test } from "vitest";
import { createContext, createOwner, createRoot } from "../../src/server/index.js";

// #5180: an owner disposed while the pool is full was dropped without the
// #4890 reset, so a reference an earlier render kept to it (after a later
// render reused it) reached the later render's provided values.
test("an owner disposed while the owner pool is full does not keep its render's context", () => {
  const Payload = createContext<{ id: number } | undefined>(undefined, { name: "Payload" });
  const created: any[] = [];

  function render(id: number, owners: number) {
    const payload = { id };
    createRoot(dispose => {
      (Payload as any)({
        value: payload,
        children: () => {
          for (let i = 0; i < owners; i++) created.push(createOwner());
          return "";
        }
      })();
      dispose();
    });
  }

  // Two renders, each with more owners than the pool holds: the second
  // reuses every pooled owner and disposes into an already-full pool.
  render(1, 5000);
  created.length = 0;
  render(2, 5000);

  expect(created).toHaveLength(5000);
  for (const o of created) {
    expect(o._disposed).toBe(true);
    expect(o._context[(Payload as any).id]).toBeUndefined();
  }
});
