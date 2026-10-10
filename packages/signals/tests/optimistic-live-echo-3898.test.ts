/**
 * #3898 — an async-generator action times out waiting for a live
 * acknowledgement even after the authoritative source, updated from outside
 * the action, already contains that acknowledgement.
 *
 * Distinct from #3482 (`direct-commit-readers-posture.test.ts`). There the
 * confirming frame is broadcast only under the action's own hold, and a
 * mainline `until()` (no bare `yield` after `await`) is born held and must
 * time out. Here the source signal is written from outside the action to the
 * same client id the optimistic draft already pushed. That echo is
 * authoritative truth, and `until()` must resolve. A bare `yield` after
 * `await` is not required for this echo.
 */
import { expect, test } from "vitest";
import {
  action,
  createOptimisticStore,
  createRoot,
  createSignal,
  flush,
  until
} from "../src/index.js";

test("external source echo satisfies until after await in an async-generator action (#3898)", async () => {
  const [source, setSource] = createSignal<{ clientId: string }[]>([]);
  let rows!: { clientId: string }[];
  let setRows!: (fn: (draft: { clientId: string }[]) => void) => void;
  let dispose!: () => void;

  createRoot(d => {
    dispose = d;
    const [r, setR] = createOptimisticStore<{ clientId: string }[]>(() => source(), []);
    rows = r;
    setRows = setR;
  });

  const save = action(async function* () {
    setRows(draft => {
      draft.push({ clientId: "c1" });
    });
    await 0; // continuation resumes outside the action context
    yield until(() => rows.some(row => row.clientId === "c1"), { timeout: 100 });
  });

  const done = save().then(
    () => "confirmed" as const,
    (error: unknown) => error
  );

  // The await-0 continuation installs until() before the outside echo lands.
  await new Promise(r => setTimeout(r, 20));
  setSource([{ clientId: "c1" }]);
  flush();

  await expect(done).resolves.toBe("confirmed");
  flush();
  expect(rows.some(row => row.clientId === "c1")).toBe(true);
  dispose();
});

// The echo is judged as reconcile would judge it: the row by key (by
// position when it has none), then leaf by leaf — key order and object
// identity are not content.
function echo(guessRow: Record<string, unknown>, sourceRow: Record<string, unknown>) {
  const [source, setSource] = createSignal<Record<string, unknown>[]>([]);
  let rows!: Record<string, unknown>[];
  let setRows!: (fn: (draft: Record<string, unknown>[]) => void) => void;
  let dispose!: () => void;
  createRoot(d => {
    dispose = d;
    const [r, setR] = createOptimisticStore<Record<string, unknown>[]>(() => source(), []);
    rows = r;
    setRows = setR;
  });
  const save = action(async function* () {
    setRows(draft => {
      draft.push(guessRow);
    });
    await 0;
    yield until(() => rows.some(row => row.clientId === "c1"), { timeout: 60 });
  });
  const done = save().then(
    () => "confirmed" as const,
    (error: unknown) => (error as Error).name
  );
  return {
    done,
    land: async () => {
      await new Promise(r => setTimeout(r, 20));
      setSource([sourceRow]);
      flush();
    },
    dispose: () => dispose()
  };
}

test("an echo with its keys in another order confirms (#3898)", async () => {
  const e = echo({ clientId: "c1", text: "hi" }, { text: "hi", clientId: "c1" });
  await e.land();
  await expect(e.done).resolves.toBe("confirmed");
  e.dispose();
});

test("an echo with nested rows confirms leaf by leaf (#3898)", async () => {
  const e = echo(
    { clientId: "c1", tags: [{ id: 1, n: "a" }] },
    { clientId: "c1", tags: [{ n: "a", id: 1 }] }
  );
  await e.land();
  await expect(e.done).resolves.toBe("confirmed");
  e.dispose();
});

test("an answer whose content differs corrects: the mainline wait is the hold's (D-31, #3482)", async () => {
  const e = echo({ clientId: "c1", text: "hi" }, { clientId: "c1", text: "edited" });
  await e.land();
  await expect(e.done).resolves.toBe("TimeoutError");
  e.dispose();
});
