import nodeResolve from "rollup-plugin-node-resolve";
import babel from 'rollup-plugin-babel';

const plugins = [
  nodeResolve({
    extensions: [".js", ".ts"]
  }),
  babel({
    extensions: ['.ts', '.js'],
    presets: ["@babel/preset-typescript"],
    exclude: 'node_modules/**'
  })
];

export default {
  input: 'src/index.ts',
  output: [{
    file: 'lib/solid-rx.js',
    format: 'cjs'
  }, {
    file: 'dist/solid-rx.js',
    format: 'es'
  }],
  external: ['solid-js'],
  plugins
};