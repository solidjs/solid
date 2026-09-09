import nodeResolve from "@rollup/plugin-node-resolve";
import babel from "@rollup/plugin-babel";
import cleanup from "rollup-plugin-cleanup";
import replace from "@rollup/plugin-replace";

const plugins = [
  nodeResolve({
    extensions: [".js", ".ts"]
  }),
  babel({
    extensions: [".js", ".ts"],
    exclude: "node_modules/**",
    babelrc: false,
    babelHelpers: "bundled",
    presets: ["@babel/preset-typescript"]
  }),
  cleanup({
    comments: ["some", /PURE/],
    extensions: [".js", ".ts"]
  })
];

// Two literals, three tiers (mirrors solid-js): dev sets both, observe sets
// only "_SOLID_OBSERVE_" (the renderer-effect labels survive, checks fold),
// prod neither. Both must be replaced in every build.
const replaceFlags = (isDev, isObserve) =>
  replace({
    '"_SOLID_DEV_"': isDev,
    '"_SOLID_OBSERVE_"': isObserve,
    preventAssignment: true,
    delimiters: ["", ""]
  });

const build = (name, isDev, isObserve) => ({
  input: "src/index.ts",
  output: { file: `dist/${name}.js`, format: "es" },
  external: ["solid-js"],
  plugins: [replaceFlags(isDev, isObserve)].concat(plugins)
});

export default [
  build("universal", false, false),
  build("universal.observe", false, true),
  build("universal.dev", true, true)
];
