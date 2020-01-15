module.exports = {
  output: 'src/dom/runtime.js',
  includeTypes: true,
  variables: {
    imports: [`import { createEffect as wrap, sample as ignore, getContextOwner as currentContext, runtimeConfig as sharedConfig } from '../index.js'`],
    includeContext: true,
    sharedConfig: true
  }
}