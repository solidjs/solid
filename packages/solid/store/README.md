# Solid Store

This submodules contains the means for handling deeps nested reactivity. It provides 2 main primitives `createStore` and `createMutable` which leverage proxies to create dynamic nested reactive structures.

This also contains helper methods `produce` and `reconcile` which augment the behavior of the store setter method to allow for localized mutationa and data diffing.

For full documentation, check out the [website](https://www.solidjs.com/docs/latest/api).

## Example

```js
import { createStore } from "solid-js/store";

const [store, setStore] = createStore({
  user: {
    firstName: "John",
    lastName: "Smith"
  }
});

// update store.user.firstName
setStore("user", "firstName", "Will");
```