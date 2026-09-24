// @vitest-environment node
/**
 * Packaging: the nested subpath manifests must never shadow the root
 * `exports` map (#3627).
 *
 * `@solidjs/web` ships a `package.json` beside every subpath directory
 * (`server-functions/`, `frames/`, …) so that legacy `node10`-style
 * resolvers — which never read `exports` — can find `main`/`module`/`types`
 * for `@solidjs/web/<subpath>`. Those files are the NEAREST manifest to
 * every artifact under `<subpath>/dist/`, and several of those artifacts
 * import the package by its bare name on purpose (`rich-args.js` →
 * `@solidjs/web/server-functions/client`, kept external by
 * `externalizeSharedClient` in rollup.config.js so the client instance is
 * shared across export conditions).
 *
 * Package self-reference is where the two meet. Resolvers that implement it
 * by prefix-matching the nearest manifest's `name` (Node's CJS `trySelf`,
 * oxc-resolver as used by Vite 8 / Rolldown) read a nested manifest carrying
 * `"name": "@solidjs/web/server-functions"` + an `exports` map, treat
 * `@solidjs/web/server-functions/client` as subpath `./client` of THAT
 * "package", find it unexported, and fail without ever consulting the root
 * map. Node's ESM resolver and Vite 7 compare the full package name and fall
 * through, which is why the bug only surfaced under Vite 8. So the nested
 * manifests carry neither `name` nor `exports`; the root map is the single
 * authority for anything that understands `exports`.
 *
 * Two layers, both against the built artifacts (the turbo `test` task
 * depends on `build`, which depends on `types`):
 *
 *  1. The static invariant: every nested manifest the package ships has no
 *     `name` and no `exports`, is `"type": "module"` (it is the nearest
 *     manifest to the dist files, so it — not the root — decides their
 *     module format), and its `main`/`module`/`types` point at files that
 *     exist.
 *  2. The resolver probe: from a consumer-shaped install (a temp dir whose
 *     `node_modules/@solidjs/web` links to the package), every bare
 *     `@solidjs/web[/…]` specifier found in each nested `dist/*.js` is
 *     resolved with the importing artifact as the parent, through BOTH
 *     Node's ESM resolver and its CJS resolver (the prefix-matching one), in
 *     a child Node so the real loaders run rather than vitest's module
 *     runner. Each must resolve to the same file the root map yields when
 *     the same specifier is resolved from the package root. This fails
 *     before the fix for `rich-args.js` under CJS.
 */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const PKG_ROOT = realpathSync(fileURLToPath(new URL("../", import.meta.url)));
const PKG_NAME = "@solidjs/web";

const rootManifest = JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8")) as {
  name: string;
  files: string[];
  exports: Record<string, unknown>;
};

/** Every nested manifest the package publishes, from the root `files` list. */
const NESTED_MANIFESTS = rootManifest.files
  .filter(f => f !== "package.json" && f.endsWith("/package.json"))
  .map(f => dirname(f))
  .sort();

/** Nested directories that ship built artifacts under `dist/`. */
const NESTED_DIST_DIRS = NESTED_MANIFESTS.filter(dir => existsSync(join(PKG_ROOT, dir, "dist")));

/**
 * Bare specifiers into this package that an artifact imports. Rollup emits
 * one static import per line and no quotes inside the binding list, so a
 * line-anchored match is exact for `import … from`, `export … from`, and
 * side-effect `import "…"`; dynamic `import("…")` is matched anywhere. A
 * `from "…"` inside a string literal (client.js has one in an error
 * message) is not at a line start and is not picked up.
 */
function selfImports(code: string): string[] {
  const found = new Set<string>();
  const patterns = [
    /^\s*(?:import|export)\b[^'";]*?\bfrom\s*["']([^"']+)["']/gm,
    /^\s*import\s*["']([^"']+)["']/gm,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g
  ];
  for (const re of patterns) {
    for (const m of code.matchAll(re)) {
      const spec = m[1];
      if (spec === PKG_NAME || spec.startsWith(PKG_NAME + "/")) found.add(spec);
    }
  }
  return [...found].sort();
}

describe(`${PKG_NAME} nested subpath manifests`, () => {
  test("the root files list ships the nested manifests this suite covers", () => {
    // The list is derived from `files`; pin its shape so a dropped entry is a
    // visible diff here rather than a silently narrower suite.
    expect(NESTED_MANIFESTS).toEqual([
      "frames",
      "performance-tracks",
      "serialization",
      "serialization/decode",
      "server-functions",
      "server-functions/rich-args",
      "storage"
    ]);
    expect(rootManifest.name).toBe(PKG_NAME);
  });

  for (const dir of NESTED_MANIFESTS) {
    test(`${dir}/package.json declares no name or exports and its legacy fields resolve`, () => {
      const manifestPath = join(PKG_ROOT, dir, "package.json");
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      // The whole of the fix: nothing a prefix-matching self-reference can
      // latch onto, nothing that can shadow the root map.
      expect(
        manifest,
        `${dir}: "name" would enable prefix-matched self-reference`
      ).not.toHaveProperty("name");
      expect(manifest, `${dir}: "exports" would shadow the root map`).not.toHaveProperty("exports");
      // What legacy consumers still need, and only that.
      expect(Object.keys(manifest).sort()).toEqual([
        "main",
        "module",
        "sideEffects",
        "type",
        "types"
      ]);
      // Nearest manifest to `<dir>/dist/*.js` decides their module format.
      expect(manifest.type).toBe("module");
      expect(manifest.sideEffects).toBe(false);
      for (const field of ["main", "module", "types"] as const) {
        const target = resolve(dirname(manifestPath), manifest[field]);
        expect(existsSync(target), `${dir}: "${field}" → ${manifest[field]} does not exist`).toBe(
          true
        );
        expect(target.startsWith(PKG_ROOT + "/"), `${dir}: "${field}" escapes the package`).toBe(
          true
        );
      }
      // The root map must own the entry the legacy fields stand in for.
      expect(rootManifest.exports, `root exports lacks "./${dir}"`).toHaveProperty(`./${dir}`);
    });
  }
});

describe(`${PKG_NAME} bare self-imports resolve from inside every nested dist`, () => {
  // A consumer-shaped install: the package sits at
  // `<consumer>/node_modules/@solidjs/web`, so an artifact's parent path
  // runs through the nested manifest first (nearest package scope) and the
  // node_modules walk up from it lands on the root manifest — exactly the
  // two lookups a published install performs.
  let consumer: string;
  let installed: string;

  beforeAll(() => {
    consumer = mkdtempSync(join(tmpdir(), "solid-web-nested-manifests-"));
    mkdirSync(join(consumer, "node_modules", "@solidjs"), { recursive: true });
    installed = join(consumer, "node_modules", "@solidjs", "web");
    symlinkSync(PKG_ROOT, installed, "junction");
  });

  afterAll(() => {
    rmSync(consumer, { recursive: true, force: true });
  });

  // One child Node per (artifact, specifier): resolve via ESM
  // (`import.meta.resolve` with an explicit parent — the flag is what allows
  // the parent argument) and via CJS (`createRequire(parent).resolve`, which
  // is the `trySelf` path), each from the artifact AND from the package
  // root. The root resolutions go through the root manifest's own
  // self-reference (`"name": "@solidjs/web"` + `exports`) and are the
  // expected values.
  const RESOLVE_PROBE = `
    import { createRequire } from "node:module";
    import { pathToFileURL } from "node:url";
    const [spec, parentFile, rootManifest] = process.argv.slice(1);
    const out = {};
    const attempt = (key, fn) => {
      try {
        out[key] = fn();
      } catch (e) {
        out[key] = { error: e.code ?? e.name, message: String(e.message).split("\\n")[0] };
      }
    };
    attempt("esmFromArtifact", () => import.meta.resolve(spec, pathToFileURL(parentFile).href));
    attempt("esmFromRoot", () => import.meta.resolve(spec, pathToFileURL(rootManifest).href));
    attempt("cjsFromArtifact", () => createRequire(parentFile).resolve(spec));
    attempt("cjsFromRoot", () => createRequire(rootManifest).resolve(spec));
    process.stdout.write(JSON.stringify(out));
  `;

  function probe(spec: string, parentFile: string) {
    return JSON.parse(
      execFileSync(
        process.execPath,
        [
          "--no-warnings",
          "--experimental-import-meta-resolve",
          "--input-type=module",
          "-e",
          RESOLVE_PROBE,
          "--",
          spec,
          parentFile,
          join(installed, "package.json")
        ],
        { encoding: "utf8" }
      )
    ) as Record<string, string | { error: string; message: string }>;
  }

  /** (artifact, specifier) pairs, collected once so the table is visible. */
  const CASES: { dir: string; file: string; spec: string }[] = [];
  for (const dir of NESTED_DIST_DIRS) {
    const distDir = join(PKG_ROOT, dir, "dist");
    for (const file of readdirSync(distDir)
      .filter(f => f.endsWith(".js"))
      .sort()) {
      for (const spec of selfImports(readFileSync(join(distDir, file), "utf8"))) {
        CASES.push({ dir, file, spec });
      }
    }
  }

  test("the scan sees the import that broke under prefix-matching resolvers", () => {
    // rich-args.js → its own package's client entry, whose specifier starts
    // with the directory the nested manifest used to call itself. If the
    // scanner ever stops finding this, the rest of this file proves nothing.
    expect(CASES).toContainEqual({
      dir: "server-functions",
      file: "rich-args.js",
      spec: `${PKG_NAME}/server-functions/client`
    });
    // frames imports the shared client too, and the root itself.
    expect(CASES).toContainEqual({
      dir: "frames",
      file: "client.js",
      spec: `${PKG_NAME}/server-functions/client`
    });
    expect(CASES).toContainEqual({ dir: "frames", file: "client.js", spec: PKG_NAME });
  });

  for (const { dir, file, spec } of CASES) {
    test(`${dir}/dist/${file} → ${spec}`, () => {
      const parentFile = join(installed, dir, "dist", file);
      const result = probe(spec, parentFile);
      // Expected: what the root map says. These must themselves succeed, or
      // the comparison below is between two failures.
      expect(typeof result.esmFromRoot, JSON.stringify(result.esmFromRoot)).toBe("string");
      expect(typeof result.cjsFromRoot, JSON.stringify(result.cjsFromRoot)).toBe("string");
      const esmExpected = fileURLToPath(result.esmFromRoot as string);
      const cjsExpected = result.cjsFromRoot as string;
      expect(esmExpected.startsWith(PKG_ROOT + "/")).toBe(true);
      expect(cjsExpected.startsWith(PKG_ROOT + "/")).toBe(true);
      // Actual: from inside the nested dist. The ESM resolver compares the
      // full package name so it never hit the bug; the CJS resolver is the
      // prefix-matching one and is what #3627 broke.
      expect(
        result.esmFromArtifact,
        `ESM from ${dir}/dist/${file}: ${JSON.stringify(result.esmFromArtifact)}`
      ).toBe(result.esmFromRoot);
      expect(
        result.cjsFromArtifact,
        `CJS from ${dir}/dist/${file}: ${JSON.stringify(result.cjsFromArtifact)}`
      ).toBe(cjsExpected);
    });
  }
});
