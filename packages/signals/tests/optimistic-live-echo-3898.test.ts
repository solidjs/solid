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
  createOptimistic,
  createOptimisticStore,
  createRoot,
  createSignal,
  flush,
  until
} from "../src/index.js";

// The echo is judged as reconcile would judge it: the row by its key, then
// leaf by leaf — key order and object identity are not content. A row
// without a key is never an echo (position is not an identity): the landing
// corrects, and a wait inside the hold still resolves on the corrected
// truth; one created outside it (after an `await` with no `yield`) delivers
// at the hold's commit, which the action is waiting on (D-31, #3482).
function echo(
  guessRow: Record<string, unknown>,
  sourceRow: Record<string, unknown>,
  options: { key?: string; inside?: boolean } = {}
) {
  const [source, setSource] = createSignal<Record<string, unknown>[]>([]);
  let rows!: Record<string, unknown>[];
  let setRows!: (fn: (draft: Record<string, unknown>[]) => void) => void;
  let dispose!: () => void;
  createRoot(d => {
    dispose = d;
    const [r, setR] = createOptimisticStore<Record<string, unknown>[]>(
      () => source(),
      [],
      options.key === undefined ? undefined : { key: options.key }
    );
    rows = r;
    setRows = setR;
  });
  const save = action(async function* () {
    setRows(draft => {
      draft.push(guessRow);
    });
    await 0; // the continuation resumes outside the action context
    if (options.inside) yield; // re-enter it before creating a reader
    yield until(() => rows.some(row => row.clientId === "c1"), { timeout: 60 });
  });
  const done = save().then(
    () => "confirmed" as const,
    (error: unknown) => (error as Error).name
  );
  return {
    done,
    rowBefore: () => rows[0],
    land: async () => {
      await new Promise(r => setTimeout(r, 20));
      setSource([sourceRow]);
      flush();
    },
    dispose: () => dispose()
  };
}

test("external source echo satisfies until after await in an async-generator action (#3898)", async () => {
  const e = echo({ clientId: "c1" }, { clientId: "c1" }, { key: "clientId" });
  await e.land();
  await expect(e.done).resolves.toBe("confirmed");
  e.dispose();
});

test("an echo with its keys in another order confirms (#3898)", async () => {
  const e = echo(
    { clientId: "c1", text: "hi" },
    { text: "hi", clientId: "c1" },
    { key: "clientId" }
  );
  await e.land();
  await expect(e.done).resolves.toBe("confirmed");
  e.dispose();
});

test("an echo with nested rows confirms leaf by leaf (#3898)", async () => {
  const e = echo(
    { clientId: "c1", tags: [{ id: 1, n: "a" }] },
    { clientId: "c1", tags: [{ n: "a", id: 1 }] },
    { key: "clientId" }
  );
  await e.land();
  await expect(e.done).resolves.toBe("confirmed");
  e.dispose();
});

test("a row without a key is never an echo: the landing corrects, and the wait inside the hold resolves on it", async () => {
  const e = echo({ clientId: "c1", text: "hi" }, { text: "hi", clientId: "c1" }, { inside: true });
  const before = e.rowBefore();
  await e.land();
  await expect(e.done).resolves.toBe("confirmed");
  flush();
  expect(e.rowBefore()).not.toBe(before); // corrected: the truth's row replaced the guess
  e.dispose();
});

test("an answer whose content differs corrects: the mainline wait is the hold's (D-31, #3482)", async () => {
  const e = echo(
    { clientId: "c1", text: "hi" },
    { clientId: "c1", text: "edited" },
    { key: "clientId" }
  );
  await e.land();
  await expect(e.done).resolves.toBe("TimeoutError");
  e.dispose();
});

// A signal is not reconciled: an optimistic signal's echo is judged by the
// signal's own `equals` (F-11 — the slot's comparator). A server's new array
// is a correction unless `equals` says otherwise.
for (const deep of [false, true])
  test(`createOptimistic (signal) judges an echo by its equals — ${deep ? "deep equals: confirms" : "default: corrects"}`, async () => {
    const [source, setSource] = createSignal<{ clientId: string }[]>([]);
    let rows!: () => { clientId: string }[];
    let guess!: (v: { clientId: string }[]) => void;
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      [rows, guess] = createOptimistic(
        () => source(),
        deep ? { equals: (a, b) => JSON.stringify(a) === JSON.stringify(b) } : undefined
      );
    });
    flush();
    const done = action(async function* () {
      guess([...rows(), { clientId: "c1" }]);
      await 0;
      yield until(() => rows().some(r => r.clientId === "c1"), { timeout: 60 });
    })().then(
      () => "confirmed",
      (e: Error) => e.name
    );
    await new Promise(r => setTimeout(r, 20));
    setSource([{ clientId: "c1" }]);
    flush();
    await expect(done).resolves.toBe(deep ? "confirmed" : "TimeoutError");
    dispose();
  });
