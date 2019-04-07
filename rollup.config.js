import nodeResolve from 'rollup-plugin-node-resolve';

const plugins = [nodeResolve()]

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
  input: 'dom/src/index.js',
  output: [{
    file: 'lib/dom.js',
    format: 'cjs'
  }, {
    file: 'dist/dom.js',
    format: 'es'
  }],
  external: ['s-js', 'dom-expressions'],
  plugins
}];