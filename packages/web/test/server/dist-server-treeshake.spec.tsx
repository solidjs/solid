/**
 * Consumer tree-shaking of the built PRODUCTION server artifact
 * (dist/server.js). Rollup shakes some module-level statements when it builds
 * the dist that esbuild and Rolldown (Vite) keep in a consumer's bundle — a
 * `Object.freeze([...plugins])`, a `Feature.X` read, a `new TextEncoder()` —
 * and any one of them holds the serializer's plugin set in every server
 * bundle, whatever it imports. esbuild is the stricter of the two here; the
 * size harness's `server:` scenarios gate the Rolldown bytes. Requires a
 * prior `pnpm build`, like the other dist specs.
 */
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { describe, expect, test } from "vitest";

const webRoot = fileURLToPath(new URL("../..", import.meta.url));
const distServer = fileURLToPath(new URL("../../dist/server.js", import.meta.url));

async function bundle(names: string) {
  const result = await build({
    stdin: {
      contents: `export { ${names} } from ${JSON.stringify(distServer)};`,
      resolveDir: webRoot,
      loader: "js"
    },
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    metafile: true,
    logLevel: "silent",
    // seroval stays bundled (it resolves from this package's own
    // dependency edge): its retention is the thing under test.
    external: ["solid-js", "solid-js/*", "@solidjs/signals"]
  });
  const [output] = Object.values(result.metafile.outputs);
  const retained = Object.entries(output.inputs)
    .filter(([, input]) => input.bytesInOutput > 0)
    .map(([id]) => id);
  return { code: result.outputFiles[0].text, retained };
}

function expectNoSerializerRetention({ code, retained }: Awaited<ReturnType<typeof bundle>>) {
  expect(retained.filter(id => id.includes("seroval-plugins"))).toEqual([]);
  // the event-stream heartbeat
  expect(code).not.toMatch(/new TextEncoder\b/);
  // the flash-cookie matcher
  expect(code).not.toMatch(/new RegExp\(/);
}

describe("dist/server.js consumer tree-shaking", () => {
  test("importing only getRequestEvent retains no serializer plugins and no TextEncoder", async () => {
    expectNoSerializerRetention(await bundle("getRequestEvent"));
  });

  test("importing only isServer retains no serializer plugins and no TextEncoder", async () => {
    expectNoSerializerRetention(await bundle("isServer"));
  });

  test("renderToString does retain the plugin set (the check above can see it)", async () => {
    const { retained } = await bundle("renderToString");
    expect(retained.some(id => id.includes("seroval-plugins"))).toBe(true);
  });
});
