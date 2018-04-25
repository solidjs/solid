import coffee2 from 'rollup-plugin-coffee2';
import nodeResolve from 'rollup-plugin-node-resolve';

export default {
  input: 'src/index.coffee',
  output: {
    exports: 'named'
  },
  plugins: [
    coffee2(),
    nodeResolve({ extensions: ['.js', '.coffee'] })
  ]
};