import S from 's-js';
import { isObject, unwrap, diff } from './utils';
const SNODE = Symbol('solid-node'),
  SPROXY = Symbol('solid-proxy');

const proxyTraps = {
  get(target, property) {
    if (property === '_state') return target;
    const value = target[property];
    if (S.isListening() && typeof value !== 'function') track(target, property, value);
    return (!isObject(value) || typeof value === 'function' || value instanceof Element) ? value : wrap(value);
  },

  set() { return true; },

  deleteProperty() { return true; }
};

function wrap(value) { return value[SPROXY] || (value[SPROXY] = new Proxy(value, proxyTraps)); }

function getDataNode(target) {
  let node = target[SNODE];
  if (!node) target[SNODE] = node = {};
  return node;
}

function track(target, property, value) {
  let node;
  if (isObject(value) && !(value instanceof Element)) {
    if (node = getDataNode(value)) {
      if (!node._self) node._self = S.makeDataNode();
      node._self.current();
    }
  }
  node = getDataNode(target);
  node[property] || (node[property] = S.makeDataNode());
  node[property].current();
}

function trigger(node, property, notify) {
  if (node[property]) node[property].next();
  if (notify && node._self) node._self.next();
}

function setProperty(state, property, value) {
  value = unwrap(value);
  if (state[property] === value) return;
  const notify = Array.isArray(state) || !(property in state);
  if (value === void 0) {
    delete state[property];
    if (Array.isArray(state)) state.length -= 1;
  }
  else state[property] = value;
  trigger(getDataNode(state), property, notify);
}

function mergeState(state, value) {
  const keys = Object.keys(value) || [];
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    setProperty(state, key, value[key]);
  }
}

function updatePath(current, path, traversed = [], replace) {
  if (path.length === 1) {
    let value = path[0];
    if (typeof value === 'function') {
      value = value(wrap(current), traversed);
      // deep map
      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i += 1)
          updatePath(current, value[i], traversed, true);
        return;
      }
    }
    return mergeState(current, value);
  }

  const part = path.shift(),
    partType = typeof part,
    isArray = Array.isArray(current);

  if (Array.isArray(part)) {
    // Ex. update('data', [2, 23], 'label', l => l + ' !!!');
    for (let i = 0; i < part.length; i++)
      updatePath(current, [part[i]].concat(path), traversed.concat([part[i]]), replace);
  } else if (isArray && partType === 'function') {
    // Ex. update('data', i => i.id === 42, 'label', l => l + ' !!!');
    for (let i = 0; i < current.length; i++)
      if (part(current[i], i)) updatePath(current[i], path.slice(0), traversed.concat([i]), replace);
  } else if (isArray && partType === 'object') {
    // Ex. update('data', { from: 3, to: 12, by: 2 }, 'label', l => l + ' !!!');
    const {from = 0, to = current.length - 1, by = 1} = part;
    for (let i = from; i <= to; i += by)
      updatePath(current[i], path.slice(0), traversed.concat([i]), replace);
  } else if (isArray && part === '*') {
    // Ex. update('data', '*', 'label', l => l + ' !!!');
    for (let i = 0; i < current.length; i++)
      updatePath(current, [i].concat(path), traversed.concat([i]), replace);
  } else if (path.length === 1) {
    let value = path[0];
    if (typeof value === 'function')
      value = value(typeof current[part] === 'object' ? wrap(current[part]) : current[part], traversed.concat([part]));
    if (!replace && current[part] != null && typeof current[part] === 'object' && value !== null && typeof value === 'object' && !Array.isArray(value))
      return mergeState(current[part], value);
    return setProperty(current, part, value);
  } else updatePath(current[part], path, traversed.concat([part]), replace);
}

export function useState(state) {
  state = unwrap(state);
  const wrappedState = wrap(state);
  return [wrappedState, setState];

  function setState() {
    const args = arguments;
    S.freeze(() => {
      if (Array.isArray(args[0])) {
        for (let i = 0; i < args.length; i += 1)
          updatePath(state, args[i]);
      } else updatePath(state, Array.prototype.slice.call(args));
    });
  }
}

export function reconcile() {
  const path = Array.prototype.slice.call(arguments, 0, -1),
    value = arguments[arguments.length - 1];
  return state => {
    state = unwrap(state);
    for (let i = 0; i < path.length; i += 1) state = state[path[i]];
    return diff(value, state, path);
  }
}

export function useMemo(fn, seed) { return S(fn, seed); }

export function useSignal(value) {
  const d = S.makeDataNode(value);
  return [d.current.bind(d), d.next.bind(d)];
}

export function useEffect(fn, deps, defer) {
  if (!deps) return S.effect(fn);
  S.on(deps, fn, undefined, defer);
}