# Storybook

This is the guide for setting up [storybook](https://storybook.js.org/) for solid components.

### Step 1: Install storybook/html

```sh
> npx -p @storybook/cli sb init --type html
```

### Step 2: Add babel-preset-solid to .babelrc

```json
{
  "presets": ["solid"]
}
```

### Step 3: Update .storybook/config.js to setup solid Root for each story

Replace the auto generated config with this:

```js
import { addDecorator, configure } from "@storybook/html";
import { createRoot } from "solid-js";

// automatically import all files ending in *.stories.js
configure(require.context("../stories", true, /\.stories\.js$/), module);

addDecorator(story => {
  return createRoot(() => story());
});
```

### Step 4: Update stories/index.stories.js

Replace the auto generated html story with this:

```js
import { console } from "global";
import { createState, onCleanup } from "solid-js";

export default {
  title: "Demo"
};

export const heading = () => <h1>Hello World</h1>;

export const button = () => {
  return <button onClick={e => console.log(e)}>Hello Button</button>;
};

function Counter() {
  const [state, setState] = createState({ count: 0 });

  const timer = setInterval(() => {
    setState({ count: state.count + 1 });
  }, 1000);

  onCleanup(() => {
    clearInterval(timer);
  });

  /* prettier-ignore */
  return <div>{(state.count)}</div>;
}

export const counter = () => {
  return <Counter />;
};
```

### Step 5: npm run storybook

Storybook will be started at port 6006
