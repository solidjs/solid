/**
 * @jsxImportSource @solidjs/web
 */
// RFC: Inert JSON Hydration & Fixed-Pump Runtime (Hash-based CSP)
// Split out of #4028 (proposal 1).
// Hydration data is emitted as inert type="application/json" script blocks.
// All executable scripts are byte-constant across renders with different data,
// enabling a build-time static CSP header with fixed SHA-256 hashes.
import { describe, expect, test } from "vitest";
import { createHash } from "crypto";
import {
  generateHydrationScript,
  HydrationScript,
  renderToStream,
  renderToString
} from "@solidjs/web";
import { createMemo, Loading } from "solid-js";
import { createJSONDataTable } from "../../serialization/src/serializer.js";

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

function collect(code: () => any, options?: any): Promise<{ chunks: string[]; html: string }> {
  return new Promise(resolve => {
    const chunks: string[] = [];
    renderToStream(code, options).pipe({
      write: (c: string) => chunks.push(c),
      end: () => resolve({ chunks, html: chunks.join("") })
    });
  });
}

const sha256 = (str: string) =>
  "sha256-" + createHash("sha256").update(str).digest("base64");

describe("Inert JSON Hydration & Fixed Pump (Hash-based CSP)", () => {
  test("inert mode emits data blocks as type='application/json'", async () => {
    const res = await collect(
      () => {
        const data = createMemo(async () => {
          await wait(10);
          return { message: "hello inert world", count: 42 };
        });
        return (
          <div>
            <Loading fallback={<span>loading...</span>}>
              <span>{data().message}</span>
            </Loading>
          </div>
        );
      },
      { inert: true }
    );

    expect(res.html).toContain('type="application/json"');
    expect(res.html).toContain('class="_$hy"');
    expect(res.html).toContain("hello inert world");
  });

  test("all executable scripts have deterministic, constant bytes across different data", async () => {
    function App(props: { text: string; num: number }) {
      const data = createMemo(async () => {
        await wait(10);
        return { text: props.text, num: props.num };
      });
      return (
        <html>
          <head>
            <HydrationScript inert />
          </head>
          <body>
            <Loading fallback={<span>loading...</span>}>
              <div>{data().text}</div>
            </Loading>
          </body>
        </html>
      );
    }

    const resA = await collect(() => <App text="Alpha" num={1} />, { inert: true });
    const resB = await collect(
      () => <App text="Beta Completely Different Data String 123456789" num={999999} />,
      { inert: true }
    );

    // Extract all executable script tags (scripts WITHOUT type="application/json")
    const extractExecutableScripts = (html: string) => {
      const matches: string[] = [];
      const regex = /<script(?![^>]*type=["']application\/json["'])[^>]*>([\s\S]*?)<\/script>/gi;
      let m;
      while ((m = regex.exec(html)) !== null) {
        matches.push(m[0]);
      }
      return matches;
    };

    const scriptsA = extractExecutableScripts(resA.html);
    const scriptsB = extractExecutableScripts(resB.html);

    expect(scriptsA.length).toBeGreaterThan(0);
    expect(scriptsA.length).toBe(scriptsB.length);

    // Every executable script tag must be byte-for-byte identical between A and B!
    for (let i = 0; i < scriptsA.length; i++) {
      expect(scriptsA[i]).toBe(scriptsB[i]);
    }

    // Verify constant hashes
    const hashesA = scriptsA.map(s => {
      const inner = s.replace(/^<script[^>]*>/, "").replace(/<\/script>$/, "");
      return sha256(inner);
    });
    const hashesB = scriptsB.map(s => {
      const inner = s.replace(/^<script[^>]*>/, "").replace(/<\/script>$/, "");
      return sha256(inner);
    });
    expect(hashesA).toEqual(hashesB);
  });

  test("client pump correctly decodes inert JSON table into _$HY.r", async () => {
    const res = await collect(
      () => {
        const data = createMemo(async () => {
          await wait(10);
          return { user: "Alice", tags: ["admin", "staff"] };
        });
        return (
          <Loading fallback={<span>loading...</span>}>
            <span>{data().user}</span>
          </Loading>
        );
      },
      { inert: true }
    );

    // Parse the inert JSON blocks from output
    const jsonBlocks: any[] = [];
    const regex = /<script type="application\/json" class="_$hy">([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = regex.exec(res.html)) !== null) {
      jsonBlocks.push(JSON.parse(m[1]));
    }

    expect(jsonBlocks.length).toBeGreaterThan(0);

    // Feed to createJSONDataTable and verify decoded values
    const table = createJSONDataTable();
    const hy: any = { r: {} };
    for (const batch of jsonBlocks) {
      for (const item of batch) {
        if (item.t === "d") {
          table.apply({ key: item.k, node: item.n, initial: item.i });
          if (item.i) hy.r[item.k] = table.get(item.k);
        }
      }
    }

    // Find the data key
    const keys = Object.keys(hy.r);
    expect(keys.length).toBeGreaterThan(0);
    // At least one key should resolve to our user object or promise
    let found = false;
    for (const k of keys) {
      const val = await hy.r[k];
      if (val && val.user === "Alice") {
        expect(val.tags).toEqual(["admin", "staff"]);
        found = true;
      }
    }
    expect(found).toBe(true);
  });
});
