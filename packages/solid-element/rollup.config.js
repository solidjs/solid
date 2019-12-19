import babel from 'rollup-plugin-babel';

const plugins = [
  babel({
    extensions: ['.js', '.ts'],
    presets: ["@babel/preset-typescript"],
    exclude: 'node_modules/**'
  })
];

export default {
  input: 'src/index.ts',
  output: [{
    file: 'lib//solid-element.js',
    format: 'cjs'
  }, {
    file: 'dist//solid-element.js',
    format: 'es'
  }],
  external: ['solid-js', 'solid-js/dom', 's-js', 'component-register'],
  plugins
};