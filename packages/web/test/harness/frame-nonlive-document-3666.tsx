/**
 * @jsxImportSource @solidjs/web
 *
 * #3666 follow-up: the document face of a NON-LIVE server component —
 * `dynamic(() => note("a"))` where `note` is a plain (non-live) server
 * function answering with a component — inside `<Loading>`. Same tree on
 * both sides so hydration ids agree; only the SOURCE differs (the server's
 * in-process answer, the client's server reference).
 *
 * Two variants: `inline` settles on a microtask (the boundary settles before
 * the shell flush; the frame is inline, no fallback markup — brenelz's
 * timeline), `streamed` takes a timer (fallback in the shell, frame
 * streamed later).
 *
 * Shared by test/server/frame-nonlive-document-3666.spec.tsx (writes the
 * artifacts) and test/hydration/frame-nonlive-document-3666.spec.tsx.
 */
import { createSignal, Loading } from "solid-js";
import { dynamic } from "@solidjs/web";

export const VARIANTS = ["inline", "streamed"] as const;
export type Variant = (typeof VARIANTS)[number];
export const fidFor = (variant: Variant, mode: string) =>
  `frame-nonlive-doc/note-${variant}-${mode}`;
export const ARGS = ["a"];

/** A client slot with state of its own — the button proves interactivity. */
export function Counter(props: { label: string }) {
  const [count, setCount] = createSignal(0);
  return (
    <button id="counter" onClick={() => setCount(count() + 1)}>
      {props.label}: {count()}
    </button>
  );
}

/** The page: the note under a `Loading`, mounted through `dynamic`. */
export function makeApp(source: () => any) {
  return () => {
    const Note = dynamic(source);
    return (
      <main>
        <Loading fallback={<p class="fb">shell-fallback</p>}>
          <Note counter={(p: any) => <Counter label={p.label} />} />
        </Loading>
      </main>
    );
  };
}

/** The server component: static markup plus a client slot. */
export function makeNoteComponent(title: string) {
  const NoteComponent = (props: { counter: any }) => (
    <article id="content">
      <h1>{title}</h1>
      <ul>
        <props.counter label="Count" />
      </ul>
    </article>
  );
  return NoteComponent;
}
