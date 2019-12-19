import nodeResolve from 'rollup-plugin-node-resolve';

export default {
  input: 'src/index.js',
  output: {
    file: 'lib/react-solid-state.js',
    format: 'cjs',
    exports: 'named'
  },
  external: ['react', 'react-dom', 'solid-js'],
  plugins: [
    nodeResolve({ extensions: ['.js'] })
  ]
};