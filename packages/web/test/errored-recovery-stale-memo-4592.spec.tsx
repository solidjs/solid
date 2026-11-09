/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #4592: `<Errored>` recovering while another memo in its content is still
 * asking for the new input. `a` and `b` both ask by `s`; `b:0` rejects and
 * the error fallback shows. `s` changes and both re-ask. `b:1` landing while
 * `a:1` is out must not reveal `a`'s answer for `s = 0` beside `s = 1` (F-1).
 * With no boundary between, the error stays the display until the frame that
 * replaces it is whole (D-39: a pending is not a value). Inside `<Loading>`,
 * the recovery re-arms the subtree: the Loading has not shown content, so it
 * catches `a:1` and shows its fallback (ruled 2026-11-02, #4627, D-39, F-4).
 */
import { render } from "@solidjs/web";
import { createMemo, createSignal, Errored, flush, Loading } from "solid-js";
import { expect, it } from "vitest";

const tick = async () => {
  for (let i = 0; i < 2; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

async function run(boundary: "none" | "loading") {
  const flights = new Map<string, { resolve: (v: number) => void; reject: (e: Error) => void }>();
  const ask = (key: string) =>
    new Promise<number>((resolve, reject) => flights.set(key, { resolve, reject }));
  const [s, setS] = createSignal(0);
  const el = document.createElement("div");
  const frames: string[] = [];
  const dispose = render(() => {
    const a = createMemo(() => ask("a:" + s()));
    const b = createMemo(() => ask("b:" + s()));
    const content = () => (
      <>
        <p>s={s()}</p>
        <p>a={a()}</p>
        <p>b={b()}</p>
      </>
    );
    return (
      <Errored fallback={<p>error</p>}>
        {boundary === "loading" ? (
          <Loading fallback={<p>loading</p>}>{content()}</Loading>
        ) : (
          content()
        )}
      </Errored>
    );
  }, el);
  await tick();
  flights.get("a:0")!.resolve(10);
  await tick();
  flights.get("b:0")!.reject(new Error("boom"));
  await tick();
  frames.push(el.textContent!);
  setS(1);
  flush();
  await tick();
  frames.push(el.textContent!); // a:1 and b:1 asked
  flights.get("b:1")!.resolve(21);
  await tick();
  frames.push(el.textContent!); // b recovers; a:1 is still out
  flights.get("a:1")!.resolve(11);
  await tick();
  frames.push(el.textContent!);
  dispose();
  return frames;
}

it("no boundary: <Errored> recovery does not show a pending memo's stale value beside its new input", async () => {
  expect(await run("none")).toEqual(["error", "error", "error", "s=1a=11b=21"]);
});

it("inside <Loading>: <Errored> recovery shows the Loading's fallback while a memo still asks (#4627)", async () => {
  expect(await run("loading")).toEqual(["error", "error", "loading", "s=1a=11b=21"]);
});
