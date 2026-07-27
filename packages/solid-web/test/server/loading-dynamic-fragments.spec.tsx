/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// jsdom, because a pending dynamic() now streams: the reveal scripts these
// documents carry are real `$df` calls that touch `document`. Under the old
// shell-blocking behavior nothing streamed and this ran fine on bare node.
//
// Two sibling <Loading> boundaries each holding a promise-backed dynamic():
// EVERY boundary's `<id>_fr` fragment record must patch in the streamed
// document, regardless of resolution order. Found via the hackernews
// example: with two dynamics pending concurrently, the FIRST to resolve
// lost its patch — its Loading hung forever client-side and hydration
// emptied the boundary.
import { describe, expect, test } from "vitest";
import { renderToStream, Loading, dynamic } from "@solidjs/web";

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

function collect(code: () => any): Promise<string> {
  return new Promise(resolve => {
    const chunks: string[] = [];
    renderToStream(code).pipe({
      write: (c: string) => chunks.push(c),
      end: () => resolve(chunks.join(""))
    });
  });
}

/**
 * Ground truth, not regexes: execute the page's hydration scripts in a
 * sandbox and report which `_fr` records actually settle.
 */
async function fragmentPatches(html: string) {
  const sandbox: any = { _$HY: { r: {}, fe() {} } };
  sandbox.self = sandbox;
  // Give the reveal scripts the markup they operate on, so $df does its real
  // work (find the template, swap the placeholder) rather than no-oping.
  document.body.innerHTML = html;
  // One shared scope for every script: the first reveal script DECLARES $df
  // and later ones only call it, so running each in its own Function scope
  // loses the declaration.
  const scripts: string[] = [];
  for (const [, code] of html.matchAll(/<script(?:\s[^>]*)?>([^]*?)<\/script>/g)) {
    if (!code.trim() || code.includes("window._$HY||")) continue;
    scripts.push(code);
  }
  // eslint-disable-next-line no-new-func
  new Function("self", "_$HY", `with(self){${scripts.join("\n;\n")}}`)(sandbox, sandbox._$HY);
  const out: Record<string, boolean> = {};
  await Promise.all(
    Object.entries(sandbox._$HY.r)
      .filter(([k]) => k.endsWith("_fr"))
      .map(async ([k, v]) => {
        out[k] = await Promise.race([
          Promise.resolve(v).then(
            () => true,
            () => true
          ),
          new Promise<boolean>(r => setTimeout(() => r(false), 50))
        ]);
      })
  );
  return out;
}

describe("concurrent promise-backed dynamics under Loading", () => {
  // Regression guard (2026-07-21): with two boundaries pending concurrently,
  // the FIRST patch is emitted in resolver-defining long form
  // (`($R[n]=(e,r)=>{…})($R[m],…)`) — pattern-matching detectors miss it
  // (which is how this test was born); executing the scripts is the truth.
  test("both fragment records patch, whichever resolves first", async () => {
    const A = () => <b>alpha</b>;
    const B = () => <i>beta</i>;
    const Fast = dynamic(() => wait(10).then(() => A));
    const Slow = dynamic(() => wait(60).then(() => B));

    const html = await collect(() => (
      <div>
        <section id="fast">
          <Loading fallback={<span>f…</span>}>
            <Fast />
          </Loading>
        </section>
        <section id="slow">
          <Loading fallback={<span>s…</span>}>
            <Slow />
          </Loading>
        </section>
      </div>
    ));

    expect(html).toContain(">alpha</b>");
    expect(html).toContain(">beta</i>");
    // Guard the streaming shape itself. A pending dynamic() must suspend into
    // its enclosing boundary, not gate the shell: if it gates, both resolve
    // before the flush, neither fallback is ever emitted, and the fragment
    // assertions below pass vacuously against a document that never streamed.
    expect(html).toContain(">f…</span>");
    expect(html).toContain(">s…</span>");
    const status = await fragmentPatches(html);
    expect(Object.keys(status).length).toBeGreaterThanOrEqual(2);
    expect(status).toEqual(Object.fromEntries(Object.keys(status).map(k => [k, true])));
  });
});
