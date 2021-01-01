import nodeResolve from '@rollup/plugin-node-resolve';
import babel from '@rollup/plugin-babel';

export default {
  input: 'src/index.ts',
  output: {
    file: 'lib/react-solid-state.js',
    format: 'cjs',
    exports: 'named'
  },
  external: ['react', 'react-dom', 'solid-js'],
  plugins: [
    nodeResolve({ extensions: ['.js', '.ts'] }),
    babel({
      extensions: ['.js', '.ts'],
      babelHelpers: "bundled",
      presets: ["@babel/preset-typescript"],
      exclude: 'node_modules/**'
    }),
  ]
};
