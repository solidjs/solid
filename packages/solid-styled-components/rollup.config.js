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
    file: 'lib//solid-styled-components.js',
    format: 'cjs'
  }, {
    file: 'dist//solid-styled-components.js',
    format: 'es'
  }],
  external: ['solid-js', 'solid-js/dom', 'goober'],
  plugins
};