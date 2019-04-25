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
  input: 'src/dom/index.ts',
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
  input: 'src/dom/html.ts',
  output: [{
    file: 'lib/html.js',
    format: 'cjs'
  }, {
    file: 'dist/html.js',
    format: 'es'
  }],
  external: ['./index', 'lit-dom-expressions'],
  plugins
}, {
  input: 'src/dom/h.ts',
  output: [{
    file: 'lib/h.js',
    format: 'cjs'
  }, {
    file: 'dist/h.js',
    format: 'es'
  }],
  external: ['./index', 'hyper-dom-expressions'],
  plugins
}];