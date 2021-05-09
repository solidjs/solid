# Help!

## Reactivity is not working

- Check your code for destructuring or use of `Object.assign`. If you use these on state or prop objects it is likely you have lost reactivity.

- If you application has duplicate instances of the `solid-js` package inside `node_modules`, this can cause reactivity to break.
  - This can happen when you've `npm link`ed dependencies into your project.
    - If you're using Webpack with `babel-preset-solid`, you may have luck fixing the issue with using the  [`RootMostResolvePlugin`](https://github.com/webpack/webpack/issues/985#issuecomment-260230782)
    - If you're using Node.js `require` in Electron (for example), you'll need to write a Require hook (see the `pirates` package, for example) to make it import the root-most version of `solid-js`. (I'm not sure if such a hook already exists).
