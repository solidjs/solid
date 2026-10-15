/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * #4087: a streamed `<Loading>` fragment that is the first to carry a
 * `lazy()` module's map (`<id>_assets`: the page renders behind `<Show>`,
 * after the shell flushed) arrives after hydration claimed the boundary.
 * The still-streaming resume read the map before the fragment brought it,
 * so it resumed without loading the module; the re-run then rendered
 * nothing while the module loaded, and that empty render cleared the
 * parent (`<main>`), removing the content the reveal had just swapped in.
 * The resume must load the fragment's modules first and claim the revealed
 * content in place.
 *
 * Replays the server's real chunks for the issue's tree (`renderToStream`
 * with a manifest answering `"/" + key`).
 */
import { expect, test, vi } from "vitest";
import { createMemo, createSignal, flush, lazy, Loading, Show } from "solid-js";
import { hydrate } from "@solidjs/web";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const SHELL =
  '<main _hk=1 id="main-content"><template id="pl-2"></template><p _hk=20>Loading\u2026</p><!--pl-2--></main><script>(self.$R=self.$R||{})[""]=[];_$HY.r["$B"]=($R[0]={0:$R[1]=($R[2]=($R[3]=() => {\n\tconst resolver = {\n\t\tp: 0,\n\t\ts: 0,\n\t\tf: 0\n\t};\n\tresolver.p = new Promise((resolve, reject) => {\n\t\tresolver.s = resolve;\n\t\tresolver.f = reject;\n\t});\n\treturn resolver;\n})()).p,"2_fr":$R[4]=($R[5]=$R[3]()).p});(b=>{for(var k in b)_$HY.r[k]=b[k];delete _$HY.r["$B"]})(_$HY.r["$B"]);</script>';
const REST =
  '<link rel="modulepreload" href="/src/Page.tsx"><script>($R[6]=(resolver, data) => {\n\tresolver.s(data);\n\tresolver.p.s = 1;\n\tresolver.p.v = data;\n})($R[2],"server data");</script><template id="2"><section _hk=200200 id="content" title="server data"><!--$--><label _hk=200201>Draft <input id="draft" value="saved draft"></label><!--/--><button id="count">0</button></section></template><script>_$HY.r["2_assets"]=($R[7]={20020:"/src/Page.tsx"});$df("2");function $df(e){return _$HY.f?_$HY.f(e):$dfr(e)}function $dfr(e,n,o,t){if(!(n=document.getElementById(e)))return 0;if(!(o=document.getElementById("pl-"+e)))return(_$HY.dq=_$HY.dq||{})[e]=1,0;for(;o&&(8!==o.nodeType||o.nodeValue!=="pl-"+e);)t=o.nextSibling,o.remove(),o=t;t=o.parentNode,o.replaceWith(n.content),n.remove(),(_$HY.v=_$HY.v||{})[e]=1,_$HY.fe(e,t),_$HY.hp&&_$HY.hp[e]&&($dh(_$HY.hp[e]),delete _$HY.hp[e]),$dfd();return 1}function $dfl(e,o,n){if(!(o=document.getElementById("pl-"+e)))return(_$HY.dlq=_$HY.dlq||{})[e]=1,0;if(o._$fl)return 1;for(n=o.nextSibling;n;){if(8===n.nodeType&&n.nodeValue==="pl-"+e){o.parentNode&&o.parentNode.insertBefore(o.content.cloneNode(!0),n),o._$fl=1,$dfd();return 1}n=n.nextSibling}return 0}function $dflj(e,i){for(i=0;i<e.length;i++)$dfl(e[i])}function $dfd(e,i){if(e=_$HY.dq){_$HY.dq=0;for(i in e)$df(i)}if(e=_$HY.dlq){_$HY.dlq=0;for(i in e)$dfl(i)}}function $dfs(e,c,d){(_$HY.sc=_$HY.sc||{})[e]=c,d&&((_$HY.sd=_$HY.sd||{})[e]=1)}function $dfg(e,g,i,k){if(!(g=_$HY.sg&&_$HY.sg[e]))return;for(i=0;i<g.length;i++)if(_$HY.sc&&_$HY.sc[g[i]]>0)return;for(i=0;i<g.length;i++)k=g[i],delete _$HY.sg[k],$df(k)}function $dfc(e){if(--_$HY.sc[e]<=0){delete _$HY.sc[e],_$HY.sg&&_$HY.sg[e]?$dfg(e):!(_$HY.sd&&_$HY.sd[e])&&$df(e);_$HY.sd&&delete _$HY.sd[e]}}function $dfj(e,i,n){for(i=0;i<e.length;i++)if(_$HY.sc&&_$HY.sc[e[i]]>0){for(n=0;n<e.length;n++)(_$HY.sg=_$HY.sg||{})[e[n]]=e;return}for(i=0;i<e.length;i++)$df(e[i])}function $dfe(e,t,k){(t=e.target)&&t.getAttribute&&!t._$dc&&(k=t.getAttribute("data-dfc"))&&(t._$dc=1,$dfc(k))}document.addEventListener("load",$dfe,!0);document.addEventListener("error",$dfe,!0);</script><script>$R[6]($R[5],!0);</script>';

function Field() {
  return (
    <label>
      Draft <input id="draft" value="saved draft" />
    </label>
  );
}
function PageImpl(props: { data: string }) {
  const [count, setCount] = createSignal(0);
  return (
    <section id="content" title={props.data}>
      <Field />
      <button id="count" onClick={() => setCount(count() + 1)}>
        {count()}
      </button>
    </section>
  );
}

function applyChunk(container: HTMLElement, chunk: string, first: boolean) {
  const scriptRe = /<script(?:[^>]*)>([\s\S]*?)<\/script>/g;
  const scripts = [...chunk.matchAll(scriptRe)].map(m => m[1]);
  const stripped = chunk.replace(scriptRe, "");
  if (first) container.innerHTML = stripped;
  else container.insertAdjacentHTML("beforeend", stripped);
  return scripts;
}

test("#4087: a fragment that first brings a lazy module's assets keeps its revealed content", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  // The page module loads on demand (keyed by the hydration id the server's
  // `_assets` map names); it is not loaded when hydration starts.
  let land!: () => void;
  const hy: any = {
    events: [],
    completed: new WeakSet(),
    r: {},
    fe() {},
    modules: {},
    loading: {}
  };
  hy.loading["20020"] = new Promise<void>(r => (land = r)).then(() => {
    hy.modules["20020"] = { default: PageImpl };
  });
  (globalThis as any)._$HY = hy;
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const error = vi.spyOn(console, "error").mockImplementation(() => {});

  for (const s of applyChunk(container, SHELL, true)) (0, eval)(s);
  const Page = lazy(() => Promise.resolve({ default: PageImpl }), undefined, "src/Page.tsx");
  const dispose = hydrate(() => {
    const data = createMemo(async () => {
      await sleep(30);
      return "server data";
    });
    return (
      <main id="main-content">
        <Loading fallback={<p>Loading…</p>}>
          <Show when={data()}>{value => <Page data={value()} />}</Show>
        </Loading>
      </main>
    );
  }, container);
  flush();
  await sleep(10);

  // The fragment streams in: its `_assets` map, the reveal, the settlement.
  for (const s of applyChunk(container, REST, false)) (0, eval)(s);
  const input = container.querySelector("#draft");
  expect(input).not.toBeNull();
  const main = container.querySelector("main")!;
  const cleared: Node[] = [];
  const observer = new MutationObserver(records => {
    for (const r of records) cleared.push(...r.removedNodes);
  });
  observer.observe(main, { childList: true });
  await sleep(10);
  flush();
  land();
  await sleep(20);
  flush();
  await sleep(10);
  flush();
  observer.disconnect();

  const messages = [...warn.mock.calls, ...error.mock.calls].map(c => String(c[0]));
  expect(messages.filter(m => m.includes("Hydration"))).toEqual([]);
  // Claimed in place: the revealed nodes were never removed from <main>.
  expect(cleared).toEqual([]);
  expect(container.querySelector("#draft")).toBe(input);
  const button = container.querySelector<HTMLButtonElement>("#count")!;
  button.click();
  flush();
  expect(button.textContent).toBe("1");
  warn.mockRestore();
  error.mockRestore();
  dispose();
  container.remove();
});
