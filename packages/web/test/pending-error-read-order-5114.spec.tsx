/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { expect, test } from "vitest";
import { Errored, Loading, createMemo, flush } from "solid-js";
import { render } from "../src/index.js";

// #5114 (ruled 2026-11-20, D-41 "What it does not say"): a pass stops at its
// first throw. A memo that reads a pending source before a rejected one stays
// pending until the pending one lands; reading the rejection first, or in a
// hole of its own, shows the error now. Every form shows the error once both
// have answered.

const tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  flush();
};

type Form = "current first" | "previous first" | "two holes";

async function run(form: Form) {
  const settle: Record<string, { ok: (v: number) => void; fail: (e: Error) => void }> = {};
  const query = (key: string) => new Promise<number>((ok, fail) => (settle[key] = { ok, fail }));
  const container = document.body.appendChild(document.createElement("div"));
  const dispose = render(() => {
    const current = createMemo(() => query("current"));
    const previous = createMemo(() => query("previous"));
    const delta = createMemo(() =>
      form === "current first" ? current() - previous() : -previous() + current()
    );
    return (
      <Errored fallback={e => <p>error: {(e() as Error).message}</p>}>
        <Loading fallback={<p>loading</p>}>
          {form === "two holes" ? (
            <p>
              {current()} {previous()}
            </p>
          ) : (
            <p>delta {delta()}</p>
          )}
        </Loading>
      </Errored>
    );
  }, container);
  await tick();
  settle.current.fail(new Error("current failed"));
  await tick();
  const afterFailure = container.textContent;
  settle.previous.ok(10);
  await tick();
  const afterBoth = container.textContent;
  dispose();
  container.remove();
  return { afterFailure, afterBoth };
}

test("a rejected read beside a pending one: read order decides the first screen", async () => {
  const forms: Form[] = ["current first", "previous first", "two holes"];
  const out: Record<string, string | null> = {};
  for (const f of forms) {
    const r = await run(f);
    expect(r.afterBoth).toBe("error: current failed");
    out[f] = r.afterFailure;
  }
  expect(out).toEqual({
    "current first": "error: current failed",
    "previous first": "loading",
    "two holes": "error: current failed"
  });
});
