import nodeResolve from 'rollup-plugin-node-resolve';
import babel from 'rollup-plugin-babel';

const plugins = [nodeResolve({
  extensions: ['.js', '.ts']
}), babel({
  extensions: ['.js', '.ts'],
  exclude: 'node_modules/**',
  "presets": ["@babel/preset-typescript"],
})]

export default [{
  input: 'src/index.ts',
  output: [{
    file: 'lib/solid.js',
    format: 'cjs'
  }, {
    file: 'dist/solid.js',
    format: 'es'
  }],
  external: ['s-js'],
  plugins
}, {
  input: 'src/dom/index.js',
  output: [{
    file: 'lib/dom/index.js',
    format: 'cjs'
  }, {
    file: 'dist/dom/index.js',
    format: 'es'
  }],
  external: ['s-js'],
  plugins: [plugins[0]]
}, {
  input: 'src/dom/html.ts',
  output: [{
    file: 'lib/dom/html.js',
    format: 'cjs'
  }, {
    file: 'dist/dom/html.js',
    format: 'es'
  }],
  external: ['./index', 'lit-dom-expressions'],
  plugins
}, {
  input: 'src/dom/h.ts',
  output: [{
    file: 'lib/dom/h.js',
    format: 'cjs'
  }, {
    file: 'dist/dom/h.js',
    format: 'es'
  }],
  external: ['./index', 'hyper-dom-expressions'],
  plugins
}];