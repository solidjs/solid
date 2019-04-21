import nodeResolve from 'rollup-plugin-node-resolve';
import babel from 'rollup-plugin-babel';

const plugins = [nodeResolve(), babel({
  exclude: 'node_modules/**'
})]

export default [{
  input: 'src/index.js',
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
    file: 'lib/dom.js',
    format: 'cjs'
  }, {
    file: 'dist/dom.js',
    format: 'es'
  }],
  external: ['s-js', 'dom-expressions'],
  plugins
}, {
  input: 'src/dom/html.js',
  output: [{
    file: 'lib/html.js',
    format: 'cjs'
  }, {
    file: 'dist/html.js',
    format: 'es'
  }],
  external: ['solid-js/dom', 'lit-dom-expressions'],
  plugins
}, {
  input: 'src/dom/h.js',
  output: [{
    file: 'lib/h.js',
    format: 'cjs'
  }, {
    file: 'dist/h.js',
    format: 'es'
  }],
  external: ['solid-js/dom', 'hyper-dom-expressions'],
  plugins
}];