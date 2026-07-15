import replace from "@rollup/plugin-replace";
import typescript from "@rollup/plugin-typescript";
import prettier from "rollup-plugin-prettier";

// Only the prod ESM build is a per-module tree (`preserveModules`); it is
// consumed exclusively by bundlers, which can drop whole feature modules —
// including their top-level GlobalQueue hook installs, which statement-level
// shaking of a flat file can never remove (#2883) — and scope-hoist the rest
// back into one module. Dev and node stay flat single files: dev bundle size
// doesn't matter (and vitest's per-module SSR transform makes a chunked tree
// ~2x slower in the flush hot path, poisoning CI benches), and CJS `require`
// can't tree-shake, so a tree would charge unbundled SSR the per-module-
// boundary cost (~10% native ESM) for nothing.
//
// `_`-prefixed property mangling for prod outputs runs as a single sequential
// post-pass (scripts/mangle-props.mjs) with one shared nameCache per output;
// per-chunk terser would mangle the same property to different names in
// different modules and break every cross-module member access.
export default [
  {
    input: "src/index.ts",
    output: {
      file: "dist/dev.js",
      format: "esm"
    },
    plugins: [
      replace({
        __DEV__: "true",
        __TEST__: "false",
        preventAssignment: true
      }),
      typescript({
        declaration: false,
        outDir: "dist",
        module: "esnext",
        target: "esnext",
        moduleResolution: "bundler",
        verbatimModuleSyntax: true
      }),
      prettier({
        parser: "typescript"
      })
    ]
  },
  {
    input: "src/index.ts",
    output: {
      dir: "dist/prod",
      format: "esm",
      preserveModules: true,
      preserveModulesRoot: "src"
    },
    plugins: [
      replace({
        __DEV__: "false",
        __TEST__: "false",
        preventAssignment: true
      }),
      typescript({
        declaration: false,
        outDir: "dist/prod",
        module: "esnext",
        target: "esnext",
        moduleResolution: "bundler",
        verbatimModuleSyntax: true
      }),
      prettier({
        parser: "typescript"
      })
    ]
  },
  {
    input: "src/index.ts",
    output: {
      file: "dist/node.cjs",
      format: "cjs",
      exports: "named"
    },
    plugins: [
      replace({
        __DEV__: "false",
        __TEST__: "false",
        preventAssignment: true
      }),
      typescript({
        declaration: false,
        outDir: "dist",
        module: "esnext",
        target: "esnext",
        moduleResolution: "bundler",
        verbatimModuleSyntax: true
      }),
      prettier({
        parser: "typescript"
      })
    ]
  }
];
