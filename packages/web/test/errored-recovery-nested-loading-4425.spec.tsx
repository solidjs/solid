/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #4425: an <Errored> showing an async memo's error is refreshed and the
 * memo lands a value. The recovered content mounts a child component whose
 * own async sits under a nested <Loading>. The outer Errored must show the
 * recovered content at the landing, with the nested Loading's fallback
 * beside it — not keep the stale failure until the child's flight answers.
 *
 * Rules: a boundary catching a flight releases the hold (F-4, D-21); a
 * boundary mounted inside a held frame is not itself born held and shows
 * its fallback at the commit (boundary-not-born-held-3540 family); the
 * refresh landing is the new answer (D-39).
 */
import { expect, test } from "vitest";
import {
  Errored,
  For,
  Loading,
  Show,
  createMemo,
  flush,
  refresh,
  type Refreshable
} from "solid-js";
import { render } from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

async function run(nested: boolean) {
  const asks: { key: string; res: (v: any) => void }[] = [];
  const ask = (key: string) => new Promise<any>(res => asks.push({ key, res }));
  const land = async (key: string, v: any) => {
    const i = asks.findIndex(a => a.key === key);
    if (i < 0) throw new Error(`not asked ${key}: ${asks.map(a => a.key)}`);
    asks.splice(i, 1)[0].res(v);
    await tick();
  };
  const container = document.body.appendChild(document.createElement("div"));
  const text = () => container.textContent;
  let detail!: Refreshable<() => any>;

  function Related(props: { title: string }) {
    const hits = createMemo(() => ask(`search:${props.title}`));
    return (
      <Loading fallback={<i>finding</i>}>
        <For each={hits()}>{(h: any) => <i>{h}</i>}</For>
      </Loading>
    );
  }

  const dispose = render(() => {
    detail = createMemo(async () => {
      const d = await ask("detail");
      if (!d) throw new Error("not found");
      return d;
    });
    return (
      <Loading fallback={<p>loading</p>}>
        <Errored fallback={(e: any) => <p>err {e().message}</p>}>
          <h2>{detail().title}</h2>
          {nested && <Show when={detail()}>{(d: any) => <Related title={d().title} />}</Show>}
        </Errored>
      </Loading>
    );
  }, container);
  await tick();

  await land("detail", null);
  expect(text(), "not found").toBe("err not found");

  refresh(detail);
  flush();
  await tick();
  expect(text(), "retry").toBe("err not found");

  await land("detail", { title: "Crash" });
  expect(text(), "retry landed").toBe(nested ? "Crashfinding" : "Crash");

  if (nested) {
    await land("search:Crash", ["a", "b"]);
    expect(text(), "search landed").toBe("Crashab");
  }

  dispose();
  container.remove();
}

test("nested=false: the recovery lands as the new answer", () => run(false));

// #4425 (F-4, D-21, D-39, boundary-not-born-held-3540). Regressed by #4401
// (5f22701a): `caught()` in signals/src/boundaries.ts walks from the catching
// Loading to every parent boundary showing its fallback and records the
// pending reader there too (D-39: a Loading hidden behind an error whose
// reader re-asks the memo the error came through). The nested Loading here is
// mounted by the recovery pass itself (its `_output` is still null), so the
// walk must not fire: its search flight is its own, not the healing
// Errored's. Was "err not found" until the search answered.
test("nested=true: the recovery lands with the nested Loading's fallback", () => run(true));
