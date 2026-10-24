/** @vitest-environment jsdom */
import { Session } from "node:inspector/promises";
import { setImmediate } from "node:timers/promises";
import { expect, test } from "vitest";
import { insert, render, setProperty } from "../src/index.js";

// This file gets a fresh module graph: the shared hook retains only its first
// select, so a test that runs after another select can miss the regression.
async function mountAndRetire() {
  const host = document.createElement("div");
  const form = document.createElement("form");
  const select = document.createElement("select");
  form.append(select);
  document.body.append(host);
  const dispose = render(() => {
    setProperty(select, "value", "b");
    insert(select, [new Option("A", "a"), new Option("B", "b")]);
    return form;
  }, host);
  await Promise.resolve();
  expect(select.value).toBe("b");
  const refs = [new WeakRef(select), new WeakRef(form), new WeakRef({ control: true })];
  dispose();
  host.remove();
  return refs;
}

test("the first value-bound select and its form are collectible after disposal", async () => {
  const refs = await mountAndRetire();
  // WeakRef targets survive their creating job, including its microtasks.
  await setImmediate();
  const inspector = new Session();
  inspector.connect();
  try {
    await inspector.post("HeapProfiler.collectGarbage");
    await inspector.post("HeapProfiler.collectGarbage");
  } finally {
    inspector.disconnect();
  }
  expect(refs.map(ref => ref.deref())).toEqual([undefined, undefined, undefined]);
});
