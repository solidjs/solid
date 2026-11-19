// #5027: a nested write through a shallow optimistic store's guess stays in
// the view: the source store it derives from keeps its own value (CS-R4:
// writes stay in the store that made them), during the action and after.
// The shallow view serves the source's nested object as the source
// store's own (CS-R43), so the guess writes the view's copy (F-11).
import { test, expect } from "vitest";
import { action, createOptimisticStore, createStore, flush } from "../../src/index.js";

test("#5027 a shallow optimistic guess leaves its source store alone", async () => {
  const [source] = createStore({ address: { city: "Paris" } });
  const [view, guess] = createOptimisticStore(
    () => source,
    undefined as any,
    {
      shallow: true
    } as any
  );
  flush();
  let open!: () => void;
  const gate = new Promise<void>(r => (open = r));
  const done = action(function* () {
    guess((d: any) => {
      d.address.city = "Rome";
    });
    yield gate;
  })();
  flush();
  expect(source.address.city).toBe("Paris");
  expect((view as any).address.city).toBe("Rome");
  open();
  await done;
  flush();
  expect(source.address.city).toBe("Paris");
  expect((view as any).address.city).toBe("Paris");
});
