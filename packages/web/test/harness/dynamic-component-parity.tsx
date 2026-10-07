/**
 * @jsxImportSource @solidjs/web
 *
 * `dynamicComponent` parity fixture: one page, two mounts — a plain client
 * component (a sync source) and a NON-LIVE server component reference (an
 * async source, under `<Loading>`) — each through ONE entry point, `dynamic`
 * or `dynamicComponent`. Same tree on both sides so hydration ids agree;
 * only the SOURCE of the note differs (the server's in-process answer, the
 * client's server reference).
 *
 * Two variants, as in frame-nonlive-document-3666: `inline` settles on a
 * microtask (the boundary settles before the shell flush; no fallback
 * markup), `streamed` takes a timer (fallback in the shell, the frame
 * streamed later with its `_fr` record).
 *
 * Shared by test/server/dynamic-component-parity.spec.tsx (renders the page
 * through each entry point, asserts the documents are byte-identical — same
 * markup, same hydration keys, same records — and writes the artifact) and
 * test/hydration/dynamic-component-parity.spec.tsx (hydrates the artifact
 * with each entry point).
 */
import { createSignal, Loading, type Component } from "solid-js";
import { dynamic, dynamicComponent } from "@solidjs/web";

export const VIAS = ["dynamic", "dynamicComponent"] as const;
export type Via = (typeof VIAS)[number];
export const VARIANTS = ["inline", "streamed"] as const;
export type Variant = (typeof VARIANTS)[number];
export const fidFor = (variant: Variant) => `dynamic-component-parity/note-${variant}`;
export const artifactFor = (variant: Variant) => `dynamic-component-parity-${variant}`;
export const ARGS = ["a"];

/** The entry point under test, as the one shape both share. */
export const mountOf = (via: Via): ((source: () => any) => Component<any>) =>
  via === "dynamic" ? dynamic : dynamicComponent;

/** A client component with state of its own — the button proves interactivity. */
export function Counter(props: { id: string; label: string }) {
  const [count, setCount] = createSignal(0);
  return (
    <button id={props.id} onClick={() => setCount(count() + 1)}>
      {props.label}: {count()}
    </button>
  );
}

/** A plain client component, mounted through the entry point from a sync source. */
export function Panel(props: { title: string }) {
  return (
    <section id="panel">
      <h2>{props.title}</h2>
      <Counter id="panel-counter" label="Panel" />
    </section>
  );
}

/** The page: the client component, then the note under a `Loading`, both through `via`. */
export function makeApp(via: Via, noteSource: () => any) {
  const mount = mountOf(via);
  return () => {
    const Client = mount(() => Panel);
    const Note = mount(noteSource);
    return (
      <main>
        <Client title="client" />
        <Loading fallback={<p class="fb">shell-fallback</p>}>
          <Note counter={(p: any) => <Counter id="note-counter" label={p.label} />} />
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
