import coffee2 from 'rollup-plugin-coffee2';
import nodeResolve from 'rollup-plugin-node-resolve';

export default [{
  input: 'src/index.coffee',
  output: [{
    file: 'lib/solid.js',
    format: 'cjs',
    exports: 'named'
  }, {
    file: 'dist/solid.js',
    format: 'es'
  }],
  external: ['symbol-observable'],
  plugins: [
    coffee2(),
    nodeResolve({ extensions: ['.js', '.coffee'] })
  ]
}, {
  input: 'dom/src/index.coffee',
  output: [{
    file: 'lib/dom.js',
    format: 'cjs',
    exports: 'named'
  }, {
    file: 'dist/dom.js',
    format: 'es'
  }],
  external: ['solid-js', 'babel-plugin-jsx-dom-expressions'],
  plugins: [
    coffee2(),
    nodeResolve({ extensions: ['.js', '.coffee'] })
  ]
}];