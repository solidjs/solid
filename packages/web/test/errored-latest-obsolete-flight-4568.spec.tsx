/**
 * @jsxImportSource @solidjs/web
 */
// #4568: under a `<Loading>` that has not revealed yet, a rejection reaches
// `<Errored>` at once even when a `latest()` reader under the same boundary
// reads a derive whose upstream still has a flight out for an older question.
// An error is an answer: it ends the wait like a value (F-12, D-41), and the
// obsolete flight answers a question no reader asks anymore.
import { render } from "@solidjs/web";
import { createMemo, createSignal, Errored, flush, latest, Loading } from "solid-js";
import { describe, expect, it } from "vitest";

const tick = async () => {
  for (let i = 0; i < 2; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

async function run(mode: "latest" | "plain", direct = true) {
  const flights = new Map<string, { resolve: (v: number) => void; reject: (e: Error) => void }>();
  const ask = (key: string) =>
    new Promise<number>((resolve, reject) => flights.set(key, { resolve, reject }));
  const [s, setS] = createSignal(0);
  const el = document.createElement("div");
  const dispose = render(() => {
    const a0 = createMemo(() => ask("a0:" + s()));
    const a1 = createMemo(async () => ask("a1:" + (await a0())));
    const c0 = createMemo(() => `${a1()}.${a0()}`);
    return (
      <Errored fallback={e => <p>error: {(e() as Error).message}</p>}>
        <Loading fallback={<p>loading</p>}>
          {direct ? <p>a0={a0()}</p> : null}
          <i>c0={mode === "latest" ? latest(c0) : c0()}</i>
        </Loading>
      </Errored>
    );
  }, el);
  await tick();
  setS(1);
  flush();
  await tick();
  flights.get("a0:1")!.resolve(12);
  await tick(); // asks a1:12
  setS(2);
  flush();
  await tick(); // asks a0:2; a1:12 is now obsolete
  flights.get("a0:2")!.reject(new Error("boom"));
  for (let i = 0; i < 6; i++) await tick();
  const afterReject = el.textContent;
  flights.get("a1:12")!.resolve(7);
  await tick(); // the obsolete flight lands
  const afterObsolete = el.textContent;
  dispose();
  return { afterReject, afterObsolete };
}

const both = { afterReject: "error: boom", afterObsolete: "error: boom" };

describe("#4568: a rejection under an unrevealed <Loading> is not held by an obsolete flight", () => {
  it("plain c0(): the rejection reaches <Errored> at once", async () => {
    expect(await run("plain")).toEqual(both);
  });
  it("latest(c0): the rejection reaches <Errored> at once", async () => {
    expect(await run("latest")).toEqual(both);
  });
  it("latest(c0) without the direct a0 reader: the rejection reaches <Errored> at once", async () => {
    expect(await run("latest", false)).toEqual(both);
  });
});
