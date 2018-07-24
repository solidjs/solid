import S from 's-js';

function shallowDiff(a, b) {
  let sa = new Set(a), sb = new Set(b);
  return a.filter(i => !sb.has(i)).concat(b.filter(i => !sa.has(i)));
}

export function selectOn(signal) {
  let index = [];
  S.on(signal, prev => {
    let id;
    if (prev != null && index[prev]) index[prev]();
    if ((id = signal()) != null) index[id]();
    return id;
  });
  return id => (valueAccessor, element, isAttr, fn) => {
    index[id] = () => fn(valueAccessor(), element);
    S.cleanup(() => index[id] = null);
  }
}

export function multiSelectOn(signal) {
  let index = [];
  S.on(signal, prev => {
    let value = signal();
    shallowDiff(value, prev).forEach(id => index[id]())
    return value;
  });
  return id => (valueAccessor, element, isAttr, fn) => {
    index[id] = () => fn(valueAccessor(), element);
    S.cleanup(() => index[id] = null);
  }
}