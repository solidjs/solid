module.exports = {
  output: 'src/dom/runtime.js',
  includeTypes: true,
  variables: {
    imports: [`import { createEffect as wrap, getContextOwner as currentContext } from '../index'`],
    includeContext: true,
    fragmentError: `import 'solid-js/fragment'.`
  }
}