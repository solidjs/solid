import S from 's-js';
import { diff, isObject, clone, unwrap, select } from './utils';

function getDataNode(target) {
  if (!('_S' in target)) {
    Object.defineProperty(target, '_S', { value: {} });
  }
  return target._S;
}

function trigger(node, property, notify) {
  if (node[property]) node[property].next();
  if (notify && node._self) node._self.next();
}

function track(target, property) {
  let value = target[property], node;
  if (Object.isFrozen(value)) {
    value = clone(value);
    target[property] = value;
  }
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
    value, notify;

  if (arguments.length === 3) {
    notify = isArray || !(arguments[1] in item);
    value = unwrap(arguments[2]);
    if (item[arguments[1]] === value) return;
    if (value === void 0) {
      delete item[arguments[1]];
      if (isArray) item.length--;
    } else item[arguments[1]] = value;

    trigger(node, arguments[1], notify);
    return;
  }

  for (const property in changes) {
    if (changes.hasOwnProperty(property)) {
      notify = isArray || !(property in item);
      value = unwrap(changes[property]);
      if (value === void 0) delete item[property];
      else item[property] = value;
      trigger(node, property, notify);
    }
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

function sample(target, property) {
  let value = target[property];

  // don't wrap
  if (!isObject(value) || value instanceof Element) return value;
  return new Proxy(value, proxyTraps);
}

const proxyTraps = {
  get(target, property) {
    if (property === '_state') return target;
    if (property === 'sample') return sample.bind(null, target);
    let value = target[property];
    if (property === 'length' || typeof property === 'symbol') return value;
    if (!S.isFrozen() || typeof value === 'function') return value;
    track(target, property);
    return sample(target, property);
  },

  set() { return true; },

  deleteProperty() { return true; }
};

export default class State {
  constructor(state = {}) {
    Object.defineProperties(this, {
      _state: { value: state, writable: true }
    });
    this.sample = sample.bind(this, state);
    for (let k in this._state) this._defineProperty(k);
  }

  set() {
    const args = arguments;
    S.freeze(() => {
      if (args.length === 1) {
        if (Array.isArray(args[0])) {
          for (let i = 0; i < args[0].length; i++) this.set.apply(this, args[0][i]);
        } else {
          for (let property in args[0]) this._setProperty(property, args[0][property]);
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

  _setProperty(property, value) {
    if (!(property in this)) this._defineProperty(property);
    value = unwrap(value);
    if ( this._state[property] === value) return;
    if (value === void 0) delete this._state[property];
    else this._state[property] = value;
    trigger(getDataNode(this._state), property);
  }

  _defineProperty(property) {
    Object.defineProperty(this, property, {
      get() {
        const value = this._state[property];
        if (!S.isFrozen() || typeof value === 'function') return value;
        track(this._state, property);
        return sample(this._state, property);
      },
      enumerable: true
    });
  }
}

State.prototype.select = select;
