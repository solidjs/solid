// @vitest-environment node
/**
 * Packaging: the frames artifacts share ONE instance of the runtimes they
 * lean on (#3641 server, #3640 client).
 *
 * `frames/src/frame-sink.ts` imports the server-function runtime, its wire
 * layer and the SSR runtime by relative path. Bundled privately into
 * `frames/dist/server*.js`, each was a second copy of module state the rest
 * of the app writes through the public entries:
 *
 *   - `handleServerFunctionRequest` records the in-flight invocation in a
 *     module-level WeakMap; `frameTransformFlightResult` read the frames
 *     copy, always empty, so every single-flight server-component response
 *     left with `X-Frame-Stream: ""` and a primary frame with id `""` — the
 *     client's `applyFlightResponse` then resolved the call to the
 *     envelope's `undefined` value and rendered nothing (#3641);
 *   - compiled SSR output arms the select-value gate (`ssrSelectValues`)
 *     through `@solidjs/web`; `renderToStream` reads it when it emits html,
 *     so the frames copy never resolved `<select value>` inside a server
 *     component.
 *
 * `externalizeFramesServerRuntime` (rollup.config.js) resolves those
 * imports to `@solidjs/web/server-functions/server` and `@solidjs/web`; the
 * client half does the same through `externalizeSharedTransport`. Neither
 * is visible from source-level specs (one module graph, one instance), so
 * this suite runs against the BUILT artifacts (the turbo `test` task depends
 * on `build`):
 *
 *  1. The static invariant: every frames artifact imports the shared
 *     entries and inlines none of their definitions.
 *  2. The behavior, per export condition (default / `development` /
 *     `observe` — each selects a different trio of artifacts): the issue's
 *     reproduction through a consumer-shaped install in a child Node, so the
 *     real resolver and loaders run rather than vitest's module runner.
 */
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const PKG_ROOT = realpathSync(fileURLToPath(new URL("../", import.meta.url)));

const SERVER_ARTIFACTS = ["server.js", "server.dev.js", "server.observe.js"];
const CLIENT_ARTIFACTS = ["client.js", "client.dev.js", "client.observe.js"];

/** The named bindings an artifact imports from `specifier`, or `null` when it doesn't import it. */
function importedNames(code: string, specifier: string): string[] | null {
  const re = new RegExp(
    `^import\\s*\\{([^}]*)\\}\\s*from\\s*["']${specifier.replace(/[/.]/g, "\\$&")}["']`,
    "m"
  );
  const m = re.exec(code);
  return m
    ? m[1]
        .split(",")
        .map(
          s =>
            s
              .trim()
              .split(/\s+as\s+/)
              .pop()!
        )
        .filter(Boolean)
    : null;
}

describe("frames/dist/server*.js share the server-function and SSR runtimes", () => {
  for (const file of SERVER_ARTIFACTS) {
    test(`${file} imports the shared entries and inlines no copy of them`, () => {
      const code = readFileSync(join(PKG_ROOT, "frames", "dist", file), "utf8");
      // The invocation ledger (#3641) and the codec entry must be the
      // handler's own instance.
      const serverFunctions = importedNames(code, "@solidjs/web/server-functions/server");
      expect(
        serverFunctions,
        `${file}: no import from @solidjs/web/server-functions/server`
      ).not.toBeNull();
      expect(serverFunctions).toEqual(
        expect.arrayContaining([
          "getEventServerFunctionInvocation",
          "guardFailures",
          "serializeStream",
          "createChunk",
          "ChunkReader",
          "frameAddress"
        ])
      );
      // The SSR runtime the sink drives must be the one compiled output
      // arms (`ssrSelectValues`) and the app renders documents with.
      const web = importedNames(code, "@solidjs/web");
      expect(web, `${file}: no import from @solidjs/web`).not.toBeNull();
      expect(web).toEqual(
        expect.arrayContaining(["renderToStream", "createLiveHoles", "isResponseEnvelope"])
      );
      // No private copy of either runtime: the registries' process-state
      // keys, the handler, the invocation reader, the renderer, the gate.
      for (const marker of [
        "solid.ServerFunctionRegistrations",
        "solid.ServerFunctionMethods",
        "function handleServerFunctionRequest",
        "function getEventServerFunctionInvocation",
        "function guardFailures",
        "function renderToStream",
        "function ssrSelectValues",
        "function resolveSSRSelectValues",
        "function isResponseEnvelope"
      ]) {
        expect(code.includes(marker), `${file} inlines "${marker}"`).toBe(false);
      }
    });
  }
});

describe("frames/dist/client*.js share the server-function client (#3640)", () => {
  for (const file of CLIENT_ARTIFACTS) {
    test(`${file} imports flight delivery from the shared client and inlines no registry`, () => {
      const code = readFileSync(join(PKG_ROOT, "frames", "dist", file), "utf8");
      const client = importedNames(code, "@solidjs/web/server-functions/client");
      expect(client, `${file}: no import from @solidjs/web/server-functions/client`).not.toBeNull();
      expect(client).toEqual(
        expect.arrayContaining([
          "deliverFlightData",
          "hasFlightMetadata",
          "configureServerFunctionsClient",
          "getServerFunctionsCodec"
        ])
      );
      for (const marker of [
        "function deliverFlightData",
        "function hasFlightMetadata",
        "function getFlightDataConsumer",
        "function configureServerFunctionsClient",
        "consumers: new Map"
      ]) {
        expect(code.includes(marker), `${file} inlines "${marker}"`).toBe(false);
      }
    });
  }
});

describe("a single-flight server-component call carries its invocation id (#3641)", () => {
  // A consumer-shaped install (the package under `node_modules/@solidjs/web`
  // of a temp dir), so the child's bare imports resolve the way a published
  // install does — root `exports` map, conditions and all.
  let consumer: string;

  // The issue's reproduction, verbatim in shape: a flight source registered,
  // a POST server-component call with `X-Single-Flight`, then the frame
  // header and the primary frame's chunk ids. Plus the SSR-runtime seam:
  // the select-value gate armed through `@solidjs/web` (what compiled output
  // does) must be seen by the frame stream's renderer.
  const PROBE = `
    import { ssr, ssrSelectValues } from "@solidjs/web";
    import {
      configureServerFunctionsServer,
      createServerReference,
      getEventServerFunctionInvocation,
      handleServerFunctionRequest,
      registerServerReference
    } from "@solidjs/web/server-functions/server";
    import {
      FRAME_STREAM_HEADER,
      frameTransformDirectResult,
      frameTransformFlightResult,
      frameTransformResult,
      renderServerComponent
    } from "@solidjs/web/frames/server";
    import { provideRequestEvent } from "@solidjs/web/storage";

    createServerReference(registerServerReference("view-1", async () => () => "view markup"));

    let handlerSawInvocation;
    configureServerFunctionsServer({
      provideEvent: provideRequestEvent,
      transformResult: frameTransformResult,
      transformDirectResult: frameTransformDirectResult,
      transformFlightResult(event, outcome, context) {
        // What the handler's own entry says about the same event — the two
        // copies disagreed before the fix (the issue's diagnostic).
        handlerSawInvocation = getEventServerFunctionInvocation(event);
        return frameTransformFlightResult(event, outcome, context);
      },
      collectFlightData: async () => ({ "route-data[]": { title: "x" } })
    });

    const res = await handleServerFunctionRequest(
      new Request("http://localhost/_server/data/view-1", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost",
          "sec-fetch-site": "same-origin",
          "x-server-function-format": "3",
          "x-single-flight": "true"
        },
        body: "[]"
      })
    );
    const text = await res.text();
    // Length-prefixed frames: \`;0x<8 hex>;\` + JSON.
    const chunks = text
      .split(/;0x[0-9a-f]{8};/)
      .filter(Boolean)
      .map(s => JSON.parse(s))
      .map(({ type, id, html }) => ({ type, id, html }));

    ssrSelectValues();
    const frame = await renderServerComponent(
      () => ssr('<select value="b"><option value="a">A</option><option value="b">B</option></select>'),
      { frame: { id: "f", version: 1 } }
    );

    process.stdout.write(
      JSON.stringify({
        header: res.headers.get(FRAME_STREAM_HEADER),
        singleFlight: res.headers.get("X-Single-Flight"),
        contentType: res.headers.get("content-type"),
        handlerSawInvocation,
        chunks,
        selectHtml: frame.find(c => c.type === "html").html
      })
    );
  `;

  beforeAll(() => {
    consumer = mkdtempSync(join(tmpdir(), "solid-web-frames-server-instance-"));
    mkdirSync(join(consumer, "node_modules", "@solidjs"), { recursive: true });
    symlinkSync(PKG_ROOT, join(consumer, "node_modules", "@solidjs", "web"), "junction");
    writeFileSync(join(consumer, "package.json"), '{"type":"module"}');
    writeFileSync(join(consumer, "probe.mjs"), PROBE);
  });

  afterAll(() => {
    rmSync(consumer, { recursive: true, force: true });
  });

  // One child Node per export condition: `--conditions` selects the tier for
  // every entry at once (frames, server-functions, the runtime, solid-js),
  // which is exactly how an app's build resolves them.
  for (const [label, flags] of [
    ["default", []],
    ["development", ["--conditions=development"]],
    ["observe", ["--conditions=observe"]]
  ] as const) {
    test(`${label} artifacts: X-Frame-Stream names the function and the primary frame carries it`, () => {
      const out = JSON.parse(
        execFileSync(process.execPath, ["--no-warnings", ...flags, "probe.mjs"], {
          cwd: consumer,
          encoding: "utf8"
        })
      );
      expect(out.contentType).toBe("application/x-frame-stream");
      expect(out.singleFlight).toBe("true");
      // The handler's entry and the frames entry read the same ledger.
      expect(out.handlerSawInvocation).toMatchObject({ id: "view-1" });
      expect(out.header).toBe("view-1");
      expect(out.chunks).toEqual([
        { type: "start", id: "view-1" },
        { type: "html", id: "view-1", html: "view markup" },
        { type: "complete", id: "view-1" },
        expect.objectContaining({ type: "outcome" })
      ]);
      // The renderer behind the frame stream is the one compiled output arms.
      expect(out.selectHtml).toBe(
        '<select><option value="a">A</option><option value="b" selected>B</option></select>'
      );
    });
  }
});
