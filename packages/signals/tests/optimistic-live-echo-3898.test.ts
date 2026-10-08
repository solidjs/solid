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
