/**
 * @jsxImportSource @solidjs/web
 *
 * Fixture for the remainder of solidjs/solid#4242: an async memo under a
 * `<Loading>` that resolves to rendered output. Two shapes:
 *
 *  - issue: the issue's repro (uncompiled `createComponent`), a `<Loading>`
 *    whose memo resolves to another `<Loading>` built in its continuation;
 *  - jsx: a compiled element created in the memo's compute and handed out
 *    through the promise.
 *
 * Neither can cross the wire, so the server refuses the landing with
 * `ASYNC_MEMO_ELEMENT` and the memo's boundary contains the error like any
 * other render error: an `<Errored>` inside the `<Loading>` renders its
 * fallback (`errored`); with none the `<Loading>` fragment rejects and the
 * client renders the subtree. Each uncontained variant has a `reference`
 * twin whose server memo rejects with a plain Error at the same position
 * (the client runs the same code), so the hydrate half can check that the
 * refusal behaves exactly like any other uncaught error there.
 *
 * `data` is the control: async memos resolving to ordinary data (objects,
 * one keyed `t`, an array, a string of markup, a Date) still serialize and
 * the client adopts them without recomputing.
 *
 * Every variant runs `inline` (the memo settles on a microtask, before the
 * shell) and `streamed` (a timer: the fallback ships in the shell and the
 * landing in a later chunk). Shared by test/server/async-memo-element-4242
 * .spec.tsx (ssr generate, writes the artifacts) and test/hydration/async-
 * memo-element-4242.spec.tsx (dom generate, replays them).
 */
import { createComponent, createMemo, createSignal, Errored, Loading } from "solid-js";
import { isServer } from "@solidjs/web";

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/**
 * The memos' wait, and a hook the hydrate half uses to count which memos
 * the client actually runs.
 */
export const control = {
  wait: (): Promise<void> => Promise.resolve(),
  log: (_: string): void => {}
};
const waits = { inline: () => Promise.resolve(), streamed: () => sleep(5) };
export type Timing = keyof typeof waits;
export function useTiming(timing: Timing) {
  control.wait = waits[timing];
}

/** The `[CODE]` an error message starts with: what the `<Errored>` fallbacks render. */
export const codeOf = (err: any) => /^\[(\w+)\]/.exec(String(err?.message))?.[1] ?? String(err);

/** The reference twins' server-side failure. */
const serverError = () => new Error("[SERVER_RENDER_ERROR] the reference twin's server error");

// The issue's shape. `errored` puts an <Errored> between each boundary and
// its memo read; `reference` makes the outer memo reject on the server.
function slot(read: () => any, fallback: string, errored: boolean) {
  return createComponent(Loading, {
    fallback,
    get children() {
      const body = () => {
        const value = createMemo(async () => read());
        return [() => value()];
      };
      return errored
        ? createComponent(Errored, {
            fallback: (err: () => any) => `caught:${codeOf(err())}`,
            get children() {
              return body();
            }
          })
        : body();
    }
  });
}
function issueApp(errored: boolean, reference: boolean) {
  return function IssueApp() {
    return slot(
      () => {
        control.log("outer");
        return control.wait().then(() => {
          if (reference && isServer) throw serverError();
          return slot(
            () => {
              control.log("inner");
              return control.wait().then(() => "nested-41");
            },
            "inner",
            errored
          );
        });
      },
      "outer",
      errored
    );
  };
}

function jsxApp(errored: boolean, reference: boolean) {
  return function JsxApp() {
    const [count, setCount] = createSignal(0);
    const outer = createMemo(() => {
      control.log("outer");
      const el = (
        <p id="inner">
          jsx-41
          <button id="counter" onClick={() => setCount(count() + 1)}>
            Count: {count()}
          </button>
        </p>
      );
      return control.wait().then(() => {
        if (reference && isServer) throw serverError();
        return el;
      });
    });
    return (
      <main>
        <Loading fallback={<i id="outer-fallback">outer</i>}>
          {errored ? (
            <Errored fallback={err => <b id="caught">{codeOf(err())}</b>}>{outer()}</Errored>
          ) : (
            outer()
          )}
        </Loading>
      </main>
    );
  };
}

export const DATE = new Date("2026-10-24T00:00:00.000Z");
/** The data variant's text, once every memo landed. */
export const DATA_TEXT =
  "Ada:x:<b>" + "plain text" + "3:<i>" + "<p>a string, not markup</p>" + DATE.toISOString();
function DataApp() {
  const [count, setCount] = createSignal(0);
  const memo = <T,>(name: string, value: T) =>
    createMemo(async () => {
      control.log(name);
      await control.wait();
      return value;
    });
  // Shapes near the element markers, all data: a nested `{ t: "<b>" }`, a
  // lone `t` key holding text, a `t`-keyed object beside other keys in an
  // array, a string of markup.
  const object = memo("object", { name: "Ada", tags: ["x"], nested: { t: "<b>" } });
  const tKeyed = memo("tKeyed", { t: "plain text" });
  const array = memo("array", [1, { t: "<i>", n: 2 }, "three"]);
  const string = memo("string", "<p>a string, not markup</p>");
  const date = memo("date", DATE);
  return (
    <main>
      <Loading fallback={<i id="data-fallback">loading</i>}>
        <ul id="data">
          <li>{object().name + ":" + object().tags.join() + ":" + object().nested.t}</li>
          <li>{tKeyed().t}</li>
          <li>{array().length + ":" + (array()[1] as { t: string }).t}</li>
          <li>{string()}</li>
          <li>{date().toISOString()}</li>
        </ul>
        <button id="counter" onClick={() => setCount(count() + 1)}>
          Count: {count()}
        </button>
      </Loading>
    </main>
  );
}

export type Variant = {
  name: string;
  App: () => any;
  shape: "issue" | "jsx" | "data";
  timing: Timing;
  errored: boolean;
  /** The plain-Error twin of an uncontained variant (`<name>-reference`). */
  reference: boolean;
};

const shapes: Omit<Variant, "name" | "timing">[] = [
  { shape: "issue", errored: false, reference: false, App: issueApp(false, false) },
  { shape: "issue", errored: false, reference: true, App: issueApp(false, true) },
  { shape: "issue", errored: true, reference: false, App: issueApp(true, false) },
  { shape: "jsx", errored: false, reference: false, App: jsxApp(false, false) },
  { shape: "jsx", errored: false, reference: true, App: jsxApp(false, true) },
  { shape: "jsx", errored: true, reference: false, App: jsxApp(true, false) },
  { shape: "data", errored: false, reference: false, App: DataApp }
];

export const variants: Variant[] = shapes.flatMap(s =>
  (["inline", "streamed"] as const).map(timing => ({
    ...s,
    timing,
    name:
      `async-memo-element-4242-${s.shape}${s.errored ? "-errored" : ""}-${timing}` +
      (s.reference ? "-reference" : "")
  }))
);
