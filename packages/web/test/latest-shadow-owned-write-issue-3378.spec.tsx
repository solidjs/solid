/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #3378: a JSX branch reading `latest(memo)` toggled off while an action is
 * pending and restored as the action resumes halted dev with
 * REACTIVE_WRITE_IN_OWNED_SCOPE. The restored branch's insert effect runs
 * before the memo's own heap slot and pulls the still-dirty memo through the
 * fresh latest() shadow; the memo's held recompute then synced its shadow
 * companion from inside that compute, and the shadow — unlike the isPending
 * companion — was created without `ownedWrite`.
 */
import { afterEach, expect, test, vi } from "vitest";
import { action, createMemo, createSignal, flush, latest } from "solid-js";
import { render } from "../src/index.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => (resolve = r));
  return { promise, resolve };
}

async function settle() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  flush();
}

afterEach(() => vi.restoreAllMocks());

test("restoring a branch that reads latest(memo) as an action resumes (#3378)", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const div = document.createElement("div");
  const [count, setCount] = createSignal(0);
  const [show, setShow] = createSignal(true);
  const gate = deferred();

  const dispose = render(() => {
    // Derived through another memo so `copy` sits at the branch effect's own
    // heap height and the restore's read pulls it before its heap slot.
    const doubled = createMemo(() => count() * 2);
    const copy = createMemo(() => doubled());
    return <main>{show() ? <p>Latest: {latest(copy)}</p> : <p>hidden</p>}</main>;
  }, div);
  flush();
  expect(div.textContent).toBe("Latest: 0");

  // Toggle the branch off while nothing is held: its shadow goes dormant.
  setShow(false);
  flush();
  expect(div.textContent).toBe("hidden");

  // The action resumes after its async gap and restores the branch in the
  // same held slice that writes the memo's source.
  const run = action(async function* () {
    await gate.promise;
    yield;
    setShow(true);
    setCount(1);
  });
  void run();
  flush();
  gate.resolve();
  await settle();
  await settle();

  expect(error).not.toHaveBeenCalled();
  expect(div.textContent).toBe("Latest: 2");
  dispose();
});
