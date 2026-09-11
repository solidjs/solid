/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */

import { expect, test } from "vitest";
import { createSignal, flush, latest } from "solid-js";
import { render } from "../src/index.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => (resolve = r));
  return { promise, resolve };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  flush();
}

test("latest() condition does not reveal an unready async branch (#3276)", async () => {
  const div = document.createElement("div");
  const answer = deferred<string>();
  const trace: Array<Record<string, unknown>> = [];
  const log = (event: string, details: Record<string, unknown> = {}) => {
    trace.push({ event, ...details });
  };
  let toggle!: () => void;

  const dispose = render(() => {
    const [entangle, setEntangle] = createSignal(false);
    const [asyncValue] = createSignal(async () => {
      log("async.compute.start");
      const value = await answer.promise;
      log("async.compute.resolve", { value });
      return value;
    });
    const a = () => {
      const condition = latest(entangle);
      log("branch.a", { condition, value: condition ? asyncValue() : "BAD" });
      return condition ? asyncValue() : "BAD";
    };
    const b = () => {
      const condition = entangle();
      log("branch.b", { condition, value: condition ? asyncValue() : "OK" });
      return condition ? asyncValue() : "OK";
    };
    toggle = () => {
      log("toggle.before", { entangle: entangle() });
      setEntangle(value => !value);
      log("toggle.after", { entangle: entangle(), latest: latest(entangle) });
    };

    return (
      <main>
        <button onClick={toggle}>toggle</button>
        <p id="a">{a()}</p>
        <p id="b">{b()}</p>
      </main>
    );
  }, div);

  expect(div.querySelector("#a")!.textContent).toBe("BAD");
  expect(div.querySelector("#b")!.textContent).toBe("OK");

  toggle();
  flush();
  if (process.env.SOLID_ISSUE_3276_TRACE)
    process.stderr.write(`ISSUE-3276 TRACE ${JSON.stringify(trace)}\n`);

  // A must obey the same async gate as B: neither branch may expose an
  // uninitialized value before the async computation resolves.
  expect(div.querySelector("#a")!.textContent).toBe("BAD");
  expect(div.querySelector("#b")!.textContent).toBe("OK");

  answer.resolve("ready");
  await settle();
  expect(div.querySelector("#a")!.textContent).toBe("ready");
  expect(div.querySelector("#b")!.textContent).toBe("ready");
  dispose();
});
