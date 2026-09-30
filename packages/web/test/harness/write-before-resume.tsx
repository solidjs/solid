/**
 * @jsxImportSource @solidjs/web
 *
 * One source (`path`) read in the shell (a sync and an async memo) and
 * inside two slow streamed boundaries: `<Side>` reads it through a sync
 * memo, an async memo, and directly; `<SyncSide>` reads it only
 * synchronously. Compiled with both generates: the server spec
 * (test/server/write-before-resume.gen.spec.tsx) writes the chunks the
 * client spec (test/hydration/write-before-resume.spec.tsx) replays.
 */
import { createMemo, createSignal, Loading } from "solid-js";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export function createSharedApp() {
  const [path, setPath] = createSignal("/a", { ownedWrite: true });

  function Side() {
    const inner = createMemo(() => "inner:" + path());
    const data = createMemo(async () => {
      const p = path();
      await sleep(60);
      return "data:" + p;
    });
    return (
      <aside>
        <span class="inner">{inner()}</span>
        <span class="data">{data()}</span>
        <span class="raw">{path()}</span>
      </aside>
    );
  }

  function SyncSide() {
    const gate = createMemo(async () => {
      await sleep(60);
      return "static";
    });
    return (
      <nav>
        <span class="gate">{gate()}</span>
        <span class="sync">{"sync:" + path()}</span>
      </nav>
    );
  }

  function App() {
    const label = createMemo(() => "label:" + path());
    const title = createMemo(async () => {
      const p = path();
      await sleep(1);
      return "title:" + p;
    });
    return (
      <main>
        <h1>{title()}</h1>
        <h2>{label()}</h2>
        <Loading fallback={<p>side-loading</p>}>
          <Side />
        </Loading>
        <Loading fallback={<p>sync-loading</p>}>
          <SyncSide />
        </Loading>
      </main>
    );
  }

  return { App, navigate: (p: string) => setPath(p) };
}
