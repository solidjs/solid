/**
 * #3898 — an async-generator action times out waiting for a live
 * acknowledgement even after the authoritative source, updated from outside
 * the action, already contains that acknowledgement.
 *
 * Distinct from #3482 (`direct-commit-readers-posture.test.ts`). There the
 * confirming frame is broadcast only under the action's own hold. Here the
 * source signal is written from outside the action to the
 * same client id the optimistic draft already pushed. That echo is
 * authoritative truth, and `until()` must resolve. A bare `yield` after
 * `await` is not required — for an echo, nor (#4263) for a correction the
 * action's open hold stages: delivery is authoritative, not the commit.
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

test("an answer whose content differs corrects, and still answers the wait: the truth contains c1 (D-31, #4263)", async () => {
  const e = echo({ clientId: "c1", text: "hi" }, { clientId: "c1", text: "edited" });
  await e.land();
  await expect(e.done).resolves.toBe("confirmed");
  e.dispose();
});

test("a row that references itself is not an echo: the landing corrects, the store stays readable", async () => {
  const g: any = { clientId: "c1" };
  g.self = g;
  const s: any = { clientId: "c1" };
  s.self = s;
  const [source, setSource] = createSignal<any[]>([]);
  let rows!: any[], setRows!: (fn: (d: any[]) => void) => void;
  let dispose!: () => void;
  createRoot(d => {
    dispose = d;
    [rows, setRows] = createOptimisticStore<any[]>(() => source(), []);
  });
  flush();
  const done = action(async function* () {
    setRows(d => {
      d.push(g);
    });
    await 0;
    yield until(() => rows.some(r => r.clientId === "c1"), { timeout: 60 });
  })();
  await new Promise(r => setTimeout(r, 20));
  setSource([s]);
  flush();
  await done.catch(() => {});
  flush();
  expect(rows.length).toBe(1);
  expect(rows[0].clientId).toBe("c1");
  dispose();
});

// A signal is not reconciled: an optimistic signal's echo is judged by the
// signal's own `equals` (F-11 — the slot's comparator). A server's new array
// is a correction unless `equals` says otherwise. Either way the truth
// contains c1, so the wait is answered (authoritative delivery, #4263).
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
    await expect(done).resolves.toBe("confirmed");
    flush();
    expect(rows()).toEqual([{ clientId: "c1" }]);
    dispose();
  });
