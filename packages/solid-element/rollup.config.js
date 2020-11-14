import babel from '@rollup/plugin-babel';

const plugins = [
  babel({
    extensions: ['.js', '.ts'],
    babelHelpers: "bundled",
    presets: ["@babel/preset-typescript"],
    exclude: 'node_modules/**'
  })
];

export default {
  input: 'src/index.ts',
  output: [{
    file: 'dist/solid-element.cjs.js',
    format: 'cjs'
  }, {
    file: 'dist/solid-element.js',
    format: 'es'
  }],
  external: ['solid-js', 'solid-js/web', 'component-register'],
  plugins
};