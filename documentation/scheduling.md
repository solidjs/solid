# Scheduling

To keep things simple scheduling is mostly handled in the background. Tasks are either queued up to be run immediately (after consolidating all the changes) or defered on to a microtask queue to processed before the next macro task cycle.

By default most computations are part of the immediate queue and it's only Sync's which default to being deferred. Since Sync's produce side effects and aren't usually used by client applications and used for rendering, in general any developer application computations will run immediately and the view will be updated at the next microtask.

What this means is that if you set a value, selectors will update immediately. However if used in the DOM that change won't propogate until the next microtask execution.

```js
var state = new State({
  user: {
    firstName: 'John'
    lastName: 'Smith'
  }
});

state.select({
  displayName: () => {
    return `${state.user.firstName} ${state.user.lastName}`;
  }
})

console.log(state.displayName); // John Smith
state.set('user', {firstName: 'Jake'});
console.log(state.displayName); // Jake Smith, immediately updated
```