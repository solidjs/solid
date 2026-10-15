/**
 * @jsxImportSource @solidjs/web
 *
 * Occlusion on the document face: server content handed to a client slot
 * the client does not place at first render. The shape is the React
 * server-components demo's sidebar (`NoteList` → `SidebarNoteContent`): the
 * server passes each item's header as `children` and its excerpt as
 * `expandedChildren`; the client fill owns the expanded state and renders
 * `{expanded() && props.expandedChildren}`.
 *
 * Item `a` starts collapsed — its excerpt is occluded and must ship once, as
 * an `sc:region:` record, never as markup. Item `b` starts open — its
 * excerpt ships once, as markup, and collapsing then expanding it remounts
 * the same content with no request.
 *
 * `LateItem` places the excerpt only after an async read settles, past the
 * synchronous slot render — the region is already serialized (and locked) by
 * then, so the late placement must add no markup.
 *
 * Shared by test/server/frame-occlusion-document.spec.tsx (writes the
 * artifact) and test/hydration/frame-occlusion-document.spec.tsx.
 */
import { createMemo, createSignal, Loading, untrack } from "solid-js";
import { dynamic, type JSX } from "@solidjs/web";

export const FID = "frame-occlusion-doc/list";
export const ARGS = ["list"];
export const OPEN_ID = "b";

export const ITEMS = [
  { id: "a", title: "Title alpha", excerpt: "Excerpt alpha" },
  { id: "b", title: "Title bravo", excerpt: "Excerpt bravo" }
];

type ItemProps = { id: string; children: JSX.Element; expandedChildren: JSX.Element };

/** The client slot fill: `SidebarNoteContent`'s expand/collapse. */
export function Item(props: ItemProps) {
  const [expanded, setExpanded] = createSignal(untrack(() => props.id) === OPEN_ID);
  return (
    <div class="item" id={`item-${props.id}`}>
      {props.children}
      <button id={`toggle-${props.id}`} onClick={() => setExpanded(!expanded())}>
        toggle
      </button>
      {expanded() && props.expandedChildren}
    </div>
  );
}

/** A fill that places the excerpt only once an async read settles. */
export function LateItem(props: ItemProps) {
  const ready = createMemo(async () => {
    await new Promise<void>(r => setTimeout(r, 5));
    return true;
  });
  return (
    <div class="item" id={`item-${props.id}`}>
      {props.children}
      <Loading fallback={<i class="late-fb">late</i>}>{ready() && props.expandedChildren}</Loading>
    </div>
  );
}

/** The page: the list under a `Loading`, mounted through `dynamic`. */
export function makeApp(source: () => any, Fill: (props: ItemProps) => any = Item) {
  return () => {
    const List = dynamic(source);
    return (
      <main>
        <Loading fallback={<p class="fb">shell-fallback</p>}>
          <List item={(p: any) => <Fill {...p} />} />
        </Loading>
      </main>
    );
  };
}

/** The server component: `NoteList`'s shape. */
export function makeListComponent() {
  const ListComponent = (props: { item: any }) => (
    <ul id="list">
      {ITEMS.map(it => (
        <li>
          <props.item
            $key={it.id}
            id={it.id}
            expandedChildren={<p class="excerpt">{it.excerpt}</p>}
          >
            <strong class="title">{it.title}</strong>
          </props.item>
        </li>
      ))}
    </ul>
  );
  return ListComponent;
}
