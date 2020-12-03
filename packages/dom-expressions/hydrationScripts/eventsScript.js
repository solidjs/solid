// unminified source
`(() => {
  _$HYDRATION = { events: [], completed: new WeakSet() };
  const lookup = (el) => {
    return el && el.hasAttribute && (el.hasAttribute("data-hk") && el || lookup((el.host && el.host instanceof Node) ? el.host : el.parentNode));
  }
  const hydrationEventHandler = (e) => {
    let node = (e.composedPath && e.composedPath()[0]) || e.target,
      el = lookup(node);
    if (el && !_$HYDRATION.completed.has(el)) _$HYDRATION.events.push([el, e]);
  }
  ["${eventNames.join(
    '","'
  )}"].forEach(name => document.addEventListener(name, hydrationEventHandler));
})();`