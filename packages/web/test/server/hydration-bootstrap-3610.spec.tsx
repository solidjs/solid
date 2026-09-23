/**
 * @jsxImportSource @solidjs/web
 *
 * The hydration bootstrap's readiness flag (#3610).
 *
 * `generateHydrationScript()` is for hand-built documents: the host places
 * the bootstrap itself, apart from the records script the render appends to
 * its output, so the two can be separated by a stylesheet and the records
 * may still be parser-pending when an `async` entry calls `hydrate()`. Its
 * bootstrap says so with `p:1`. `<HydrationScript />` renders inside the
 * document: `assembleDocument` splices the shell's records script right
 * after it at `<!--xs-->`, so the two execute back to back and the flag is
 * omitted — a JSX document never waits.
 */
import { describe, expect, test } from "vitest";
import {
  renderToString,
  renderToStream,
  generateHydrationScript,
  HydrationScript
} from "@solidjs/web";
import { createMemo, Loading } from "solid-js";

const BOOTSTRAP_TAIL_OUT_OF_BAND = `(_$HY={events:[],completed:new WeakSet,r:{},fe(){},p:1});</script><!--xs-->`;
const BOOTSTRAP_TAIL_IN_RENDER = `(_$HY={events:[],completed:new WeakSet,r:{},fe(){}});</script><!--xs-->`;

describe("hydration bootstrap readiness flag (#3610)", () => {
  test("generateHydrationScript() — hand-built documents — declares records may be pending", () => {
    const script = generateHydrationScript();
    expect(script.startsWith("<script>window._$HY||")).toBe(true);
    expect(script.endsWith(BOOTSTRAP_TAIL_OUT_OF_BAND)).toBe(true);
    // Options still apply around the flag.
    const custom = generateHydrationScript({ nonce: "n0", eventNames: ["click"] });
    expect(custom.startsWith('<script nonce="n0">')).toBe(true);
    expect(custom).toContain('["click"].forEach');
    expect(custom.endsWith(BOOTSTRAP_TAIL_OUT_OF_BAND)).toBe(true);
  });

  test("<HydrationScript /> — JSX documents — omits the flag", () => {
    const html = renderToString(() => <HydrationScript />);
    expect(html.startsWith("<script>window._$HY||")).toBe(true);
    expect(html.endsWith(BOOTSTRAP_TAIL_IN_RENDER)).toBe(true);
    expect(html).not.toContain("p:1");
    // Props still apply.
    const custom = renderToString(() => <HydrationScript nonce="n0" eventNames={["click"]} />);
    expect(custom.startsWith('<script nonce="n0">')).toBe(true);
    expect(custom).toContain('["click"].forEach');
    expect(custom.endsWith(BOOTSTRAP_TAIL_IN_RENDER)).toBe(true);
  });

  test("a JSX document's records script is spliced immediately after its bootstrap", async () => {
    // The adjacency the omitted flag rests on: bootstrap, records, marker —
    // nothing between the first two scripts for a stylesheet to separate.
    function Data() {
      const v = createMemo(async () => {
        await new Promise(r => setTimeout(r, 5));
        return "late";
      });
      return <span>{v()}</span>;
    }
    const chunks: string[] = [];
    await new Promise<void>(done => {
      renderToStream(() => (
        <html>
          <head>
            <HydrationScript />
            <link rel="stylesheet" href="/app.css" />
          </head>
          <body>
            <Loading fallback={<p>loading</p>}>
              <Data />
            </Loading>
          </body>
        </html>
      )).pipe({
        write: (c: string) => {
          chunks.push(c);
        },
        end: done
      });
    });
    const shell = chunks[0];
    const bootstrapEnd = shell.indexOf("</script>") + "</script>".length;
    expect(shell.slice(bootstrapEnd)).toMatch(/^<script>\(self\.\$R=self\.\$R\|\|\{\}\)/);
    expect(shell.indexOf("<!--xs-->")).toBeGreaterThan(bootstrapEnd);
    expect(shell.indexOf('<link rel="stylesheet"')).toBeGreaterThan(shell.indexOf("<!--xs-->"));
    expect(shell).not.toContain("p:1");
  });
});
