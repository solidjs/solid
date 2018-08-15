import nodeResolve from 'rollup-plugin-node-resolve';

export default [{
  input: 'src/index.js',
  output: [{
    file: 'lib/solid.js',
    format: 'cjs',
    exports: 'named'
  }, {
    file: 'dist/solid.js',
    format: 'es'
  }],
  external: ['s-js'],
  plugins: [nodeResolve({ extensions: ['.js'] })]
}, {
  input: 'dom/src/index.js',
  output: [{
    file: 'lib/dom.js',
    format: 'cjs'
  }, {
    file: 'dist/dom.js',
    format: 'es'
  }],
  external: ['s-js', 'babel-plugin-jsx-dom-expressions'],
  plugins: [nodeResolve({ extensions: ['.js'] })]
}];