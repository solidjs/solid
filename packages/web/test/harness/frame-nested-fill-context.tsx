/**
 * @jsxImportSource @solidjs/web
 *
 * Context through nested slot fills. A client fill is a client component:
 * the server content it places (a region) is part of its subtree, so a
 * fill nested in that content sees the context the enclosing fill provides
 * — on the server render, at hydration, and when an occurrence mounts out
 * of order under deferred hydration.
 *
 * `Panel` (the `panel` fill) provides `Theme` around the server content it
 * receives as `children`; `Badge` (the `badge` fill, placed by the server
 * inside that content) reads it — noting what it read in `seen` — and
 * counts clicks. A second `badge` sits outside any panel and reads the
 * default. `Drawer` provides its own theme and places its content only
 * while open: the first starts open (its content is markup), the second
 * closed (its content is an occluded region record).
 *
 * Shared by test/server/frame-nested-fill-context.spec.tsx (writes the
 * artifact) and test/hydration/frame-nested-fill-context*.spec.tsx.
 */
import { createContext, createSignal, Loading, untrack, useContext } from "solid-js";
import { dynamic, type JSX } from "@solidjs/web";

export const FID = "frame-nested-ctx/page";
export const ARGS = ["page"];

export const Theme = createContext("default");

/** The enclosing fill: provides the theme around the server content. */
export function Panel(props: { children: JSX.Element }) {
  return (
    <Theme value="dark">
      <section class="panel">{props.children}</section>
    </Theme>
  );
}

/** An enclosing fill that places its content only while open. */
export function Drawer(props: { id: string; open: boolean; children: JSX.Element }) {
  const [open, setOpen] = createSignal(untrack(() => props.open));
  return (
    <Theme value="drawer">
      <button id={`toggle-${props.id}`} onClick={() => setOpen(!open())}>
        toggle
      </button>
      {open() && props.children}
    </Theme>
  );
}

/** Each badge mount's id and the theme it read. */
export const seen: string[] = [];

/** The nested fill: reads the theme of whatever encloses it. */
export function Badge(props: { id: string }) {
  const [clicks, setClicks] = createSignal(0);
  const theme = useContext(Theme);
  seen.push(`${untrack(() => props.id)}=${theme}`);
  return (
    <button id={`badge-${props.id}`} onClick={() => setClicks(c => c + 1)}>
      {theme}:{clicks()}
    </button>
  );
}

/** The page: the server component under a `Loading`, mounted through `dynamic`. */
export function makeApp(source: () => any) {
  return () => {
    const Page = dynamic(source);
    return (
      <main>
        <Loading fallback={<p class="fb">shell-fallback</p>}>
          <Page
            panel={(p: any) => <Panel {...p} />}
            drawer={(p: any) => <Drawer {...p} />}
            badge={(p: any) => <Badge {...p} />}
          />
        </Loading>
      </main>
    );
  };
}

/** The server component: badges inside a panel's and drawers' content, and one outside. */
export function makePageComponent() {
  return (props: { panel: any; drawer: any; badge: any }) => (
    <div id="page">
      <props.panel>
        <p class="body">
          <props.badge id="in" />
        </p>
      </props.panel>
      <props.badge id="out" />
      <props.drawer id="d1" open>
        <props.badge id="d1" />
      </props.drawer>
      <props.drawer id="d2" open={false}>
        <props.badge id="d2" />
      </props.drawer>
    </div>
  );
}
