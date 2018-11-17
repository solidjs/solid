import S from 's-js';
import { diff, isObject, unwrap } from './utils';
const SNODE = Symbol('solid-node'),
  SPROXY = Symbol('solid-proxy');

function getDataNode(target) {
  let node = target[SNODE];
  if (!node) target[SNODE] = node = {};
  return node;
}

function trigger(node, property, notify) {
  if (node[property]) node[property].next();
  if (notify && node._self) node._self.next();
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

function setNested(item, changes) {
  let node = getDataNode(item),
    isArray = Array.isArray(item),
    value, notify, keys;

  if (arguments.length === 3) {
    notify = isArray || !(arguments[1] in item);
    value = unwrap(arguments[2], true);
    if (item[arguments[1]] === value) return;
    if (value === void 0) {
      delete item[arguments[1]];
      if (isArray) item.length--;
    } else item[arguments[1]] = value;

    trigger(node, arguments[1], notify);
    return;
  }

  keys = Object.keys(changes);
  for (let i = 0, l = keys.length; i < l; i++) {
    const property = keys[i];
    notify = isArray || !(property in item);
    value = unwrap(changes[property], true);
    if (value === void 0) delete item[property];
    else item[property] = value;
    trigger(node, property, notify);
  }
}

function resolvePath(current, path, length) {
  let i = 0, temp;
  while (i < length && (temp = current[path[i]]) != null) {
    current = temp;
    i++;
  }
  return current;
}

function wrap(value) { return value[SPROXY] || (value[SPROXY] = new Proxy(value, proxyTraps)); }

function resolveAsync(value, fn) {
  if (!isObject(value)) return fn(value);
  if ('subscribe' in value) {
    const dispose = value.subscribe(fn);
    S.cleanup(function disposer() { dispose.unsubscribe(); });
    return;
  }
  if ('then' in value) {
    value.then(fn);
    return;
  }
  fn(value);
}

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

export default class State {
  constructor(state = {}) {
    Object.defineProperties(this, {
      _state: { value: unwrap(state, true), writable: true }
    });
    const keys = Object.keys(this._state);
    for (let i = 0, l = keys.length; i < l; i++) this._defineProperty(keys[i]);
  }

  set() {
    const args = arguments;
    S.freeze(() => {
      if (args.length === 1) {
        if (Array.isArray(args[0])) {
          for (let i = 0; i < args[0].length; i++) this.set.apply(this, args[0][i]);
        } else {
          const keys = Object.keys(args[0]);
          for (let i = 0, l = keys.length; i < l; i++) {
            const property = keys[i];
            this._setProperty(property, args[0][property]);
          }
        }
        return;
      }

      setNested(resolvePath(this._state, args, args.length - 1), args[args.length - 1]);
    });
    return this;
  }

  replace() {
    if (arguments.length === 1) {
      if (!(arguments[0] instanceof Object)) {
        console.log('replace must be provided a replacement state');
        return this;
      }
      let changes = arguments[0];
      S.freeze(() => {
        if (!(Array.isArray(changes))) changes = diff(changes, this._state);

        for (let i = 0; i < changes.length; i++) this.replace.apply(this, changes[i]);
      });
      return this;
    }

    if (arguments.length === 2) {
      this._setProperty.apply(this, arguments);
      return this;
    }

    const value = arguments[arguments.length - 1],
      property = arguments[arguments.length - 2];
    setNested(resolvePath(this._state, arguments, arguments.length - 2), property, value);
    return this;
  }

  select() {
    const mapFn1 = selection => () => {
      const unwrapped = unwrap(selection(), true),
        results = [];
      resolveAsync(unwrapped, (value) => {
        if (value === void 0) return;
        for (let key in value || {}) {
          results.push(diff(value[key], this._state[key], [key]));
        }
        this.replace([].concat(...results));
      });
    };

    const mapFn2 = (key, selector) => () => {
      const unwrapped = unwrap(selector(), true);
      resolveAsync(unwrapped, (value) => {
        if (value === void 0) return;
        this.replace(diff(value, this._state[key], [key]));
      });
    };

    for (let i = 0; i < arguments.length; i++) {
      const selection = arguments[i];
      if (typeof selection === 'function') {
        S.makeComputationNode(mapFn1(selection));
        continue;
      }
      for (let key in selection) {
        if (!(key in this)) this._defineProperty(key);
        S.makeComputationNode(mapFn2(key, selection[key]));
      }
    }
    return this;
  }

  _setProperty(property, value) {
    if (!(property in this)) this._defineProperty(property);
    value = unwrap(value, true);
    if (this._state[property] === value) return;
    if (value === void 0) delete this._state[property];
    else this._state[property] = value;
    trigger(getDataNode(this._state), property);
  }

  _defineProperty(property) {
    Object.defineProperty(this, property, {
      get() {
        const value = this._state[property];
        if (S.isListening()) track(this._state, property, value);
        return (!isObject(value) || typeof value === 'function' || value instanceof Element) ? value : wrap(value);
      },
      enumerable: true
    });
  }
}
