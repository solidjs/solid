# Solid Styled JSX
[![Build Status](https://img.shields.io/travis/com/ryansolid/solid.svg?style=flat)](https://travis-ci.com/ryansolid/solid)
[![NPM Version](https://img.shields.io/npm/v/solid-styled-jsx.svg?style=flat)](https://www.npmjs.com/package/solid-styled-jsx)
![](https://img.shields.io/librariesio/release/npm/solid-styled-jsx)
![](https://img.shields.io/npm/dm/solid-styled-jsx.svg?style=flat)

This library is a wrapper to allow you to use Solid with Zeit's [styled-jsx](https://github.com/zeit/styled-jsx). It accomplishes this by using a babel transform to change the Style JSX element import to use Solid's version. From there simply add the plugin `solid-styled-jsx/babel` to your babel config and you are good to go. The plugin accepts the same options as it's `styled-jsx/babel` counterpart.

**Note: SSR not supported yet**
**Note: Does not work with Create Solid App**

## Typescript

To get the proper JSX types in your project simply import `solid-styled-jsx` one time at the root of your project.

```jsx
import "solid-styled-jsx";
```

## Gist

Styled JSX lets you use style tags and string class names to style your components with scoped styles. You indicate that a style tag is to be handled by including the `jsx` prop. In addition you can add `global` prop for global non-scoped styles and `dynamic` for ones that have styles that change based on props. Typical reactive rules apply. Example:

```jsx
function Button() {
  const [isLoggedIn, login] = createSignal(false);
  return (
    <>
      <button className="button" onClick={() => login(!isLoggedIn())}>
        {isLoggedIn() ? "Log Out" : "Log In"}
      </button>
      <style jsx dynamic>
        {`
          .button {
            background-color: ${isLoggedIn() ? "blue" : "green"};
            color: white;
            padding: 20px;
            margin: 10px;
          }
        `}
      </style>
    </>
  );
}
```

Styled JSX provides a ton more like `css` function and a ton of plugins. Full documentation features can be found on [styled-jsx](https://github.com/zeit/styled-jsx) site.