# Solid Styled Components

[![Build Status](https://github.com/solidui/solid/workflows/Solid%20CI/badge.svg)](https://github.com/solidui/solid/actions/workflows/main-ci.yml)
[![NPM Version](https://img.shields.io/npm/v/solid-styled-components.svg?style=flat)](https://www.npmjs.com/package/solid-styled-components)
![](https://img.shields.io/librariesio/release/npm/solid-styled-components)
![](https://img.shields.io/npm/dm/solid-styled-components.svg?style=flat)

This library provides Styled Components and css helper found in popular JS in CSS libraries. This library uses [goober](https://github.com/cristianbote/goober) a 1kb style library with a wrapper to work with Solid's API. The wrapper also adds a Theming solution.

## Features

### `styled(tagName)`

- `@param {String} tagName` The name of the dom element you'd like the styled to be applied to
- `@returns {Function}` Returns the tag template function.

```js
import { styled } from "solid-styled-components";

const Btn = styled("button")`
  border-radius: 4px;
`;
```

#### Tagged Templates

```jsx
import { styled } from "solid-styled-components";

const Btn = styled("button")`
  border-radius: ${props => props.size}px;
`;

<Btn size={20} />;
```

#### Function returns a string

```jsx
import { styled } from "solid-styled-components";

const Btn = styled("button")(
  props => `
  border-radius: ${props.size}px;
`
);

<Btn size={20} />;
```

#### Style Object

```jsx
import { styled } from "solid-styled-components";

const Btn = styled("button")(props => ({
  borderRadius: props.size + "px"
}));

<Btn size={20} />;
```

### `css`

- `@returns {String}` Returns the className.

To create a className, you need to call `css` with your style rules in a tagged template:

```jsx
import { css } from "solid-styled-components";

const BtnClassName = css`
  border-radius: 4px;
`;

const App => <button className={BtnClassName}>click</button>
```

Or an object:

```js
import { css } from "solid-styled-components";

const BtnClassName = css({ borderRadius: "4px" })

const App => <button className={BtnClassName}>click</button>
```

#### Passing props to `css` tagged templates

```js
import { css } from "solid-styled-components";

// JSX
const CustomButton = props => (
  <button
    className={css`
      border-radius: ${props.size}px;
    `}
  >
    click
  </button>
);
```

### `extractCss(target?)`

- `@returns {String}`

Returns the `<style>` tag that is rendered in a target and clears the style sheet. Defaults to `<head>`. Used to grab the styles for SSR.

```js
const { extractCss } = require("goober");

// After your app has rendered, just call it:
const styleTag = `<style id="_goober">${extractCss()}</style>`;

// Note: To be able to `hydrate` the styles you should use the proper `id` so `goober` can pick it up and use it as the target from now on
```

### `glob`

To create a global style, you need to call `glob` with your global tagged template.

```js
import { glob } from "solid-styled-components";

glob`
  html,
  body {
    background: light;
  }

  * {
    box-sizing: border-box;
  }
`;
```

### `createGlobalStyles`

For a global style component, you call `createGlobalStyles` with your global tagged template.

```js
import { createGlobalStyles } from "solid-styled-components";

const GlobalStyles = () => {
  const Styles = createGlobalStyles`
    html,
    body {
      background: light;
    }

    * {
      box-sizing: border-box;
    }
  `;
  return <Styles />;
}
```

### `Theme`
You can set a Theme Provider (remember to use state or signals if you want it to be reactive)

```jsx
import { styled, ThemeProvider } from "solid-styled-components";

const theme = {
  colors: {
    primary: "hotpink"
  }
};

const SomeText = styled('div')`
  color: ${props => props.theme.colors.primary};
`;

render(
  () => (
    <ThemeProvider theme={theme}>
      <SomeText>some text</SomeText>
    </ThemeProvider>
  ),
  document.getElementById("app")
);
```
The library provides a `useTheme` hook if you wish to use it elsewhere like in you `css` functions.

### `setup(prefixer: (key: string, value: any) => string)`

Set up a custom prefixer.
