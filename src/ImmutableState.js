import S from 's-js'
import { diff, unwrap, isObject, clone, select } from './utils';

var clockTime = 0;

function track(target, property, key) {
  target[property][key] || (target[property][key] = S.makeDataNode());
  target[property][key].current();
}

function register(target, property) {
  if (!target[property]) {
    target[property] = {
      _root: target._root || target,
      _clock: clockTime,
      _path: target._path.concat([property]),
      _state: target._state[property]
    }
  }
}

function sample(target, property) {
  let value = target._state[property];
  if (isObject(value) && !(value instanceof Element)) {
    register(target, property);
    value = new Proxy(target[property], proxyTraps);
  }
  return value;
}

function resolveState(target) {
  var current = target._root._state,
    i = 0,
    l = target._path.length;
  while (i < l) {
    if (current) current = current[target._path[i]]
    i++;
  }
  target._state = current;
  target._clock = clockTime;
}

const proxyTraps = {
  set() { return true; },

  deleteProperty() { return true; },

  has(target, property) {
    if (target._clock < clockTime) resolveState(target);
    return Reflect.has(target._state, property);
  },

  ownKeys(target) {
    if (target._clock < clockTime) resolveState(target);
    return Reflect.ownKeys(target._state);
  },

  getOwnPropertyDescriptor(target, property) {
    if (target._clock < clockTime) resolveState(target);
    var descriptors = Reflect.getOwnPropertyDescriptor(target._state, property);
    // hack for invariant
    descriptors.configurable = true;
    return descriptors;
  },

  get(target, property) {
    var value;
    if (target._clock < clockTime) resolveState(target);
    if (property === '_state') return target._state;
    if (property === 'sample') return sample.bind(null, target);
    if (property === 'length' || typeof property === 'symbol') return target._state[property];
    if (property.endsWith('$')) {
      property = property.slice(0, -1);
      value = target._state[property];
      if (!S.isListening() || typeof value === 'function') return value;
      register(target, property);
      track(target, property, '_subTree');
      return value;
    }
    value = target._state[property];
    if (!S.isListening() || typeof value === 'function') return value;
    register(target, property);
    track(target, property, '_self');
    if (isObject(value) && !(value instanceof Element)) value = new Proxy(target[property], proxyTraps);
    return value;
  }
}

export default class ImmutableState {
  constructor(state = {}) {
    Object.defineProperties(this, {
      _state: {value: state, writable: true},
      _nodes: {value: {_path: [], _state: state}, writable: true}
    });
    this.select = select.bind(this);
    this.sample = sample.bind(this, this._nodes);
    for (var k in this._state) this._defineProperty(k);
  }

  set() {
    var args = arguments, ref,
      clearMutation = !ImmutableState.inMutation;
    if (clearMutation) clockTime++;
    ImmutableState.inMutation = true;
    S.freeze(() => {
      if (args.length === 1) {
        if (Array.isArray(args[0]))
          for (let i = 0; i < args[0]; i++)
            this.set.apply(this, args[0][i]);
        else
          for (let property in args[0])
            this._setProperty(property, args[0][property]);
        return;
      }
      var changes = args[args.length - 1],
        notify, value, property,
        {state, subs, subPaths} = this._resolvePath(args, args.length - 1);
      if (!state) return;
      notify = Array.isArray(state);
      for (property in changes) {
        value = unwrap(changes[property]);
        if (state[property] === value) continue;
        notify = notify || !(property in state);
        if (value === void 0)
          delete state[property];
        else state[property] = value;
        if (subs)
          (ref = subs[property]) != null && ref._self ? ref._self.next() : void 0;
      }
      if (notify && subs && subs._self) subs._self.next();
      for (let i = 0; i < subPaths.length; i++) subPaths[i].next();
    });
    if (clearMutation) ImmutableState.inMutation = false;
    return this;
  }

  replace() {
    var ref,
      clearMutation = !ImmutableState.inMutation;
    if (clearMutation) clockTime++;
    ImmutableState.inMutation = true;
    if (arguments.length === 1) {
      if (!(arguments[0] instanceof Object)) {
        console.log('replace must be provided a replacement state');
        if (clearMutation) ImmutableState.inMutation = false;
        return this;
      }
      var changes = arguments[0];
      S.freeze(() => {
        if (!(Array.isArray(changes))) changes = diff(changes, this._state);

        for (let i = 0; i < changes.length; i++) this.replace.apply(this, changes[i]);
      })
      if (clearMutation) ImmutableState.inMutation = false;
      return this;
    }

    if (arguments.length === 2) {
      this._setProperty.apply(this, arguments)
      if (clearMutation) ImmutableState.inMutation = false;
      return this;
    }

    var value = unwrap(arguments[arguments.length - 1]),
      property = arguments[arguments.length - 2],
      notify,
      {state, subs, subPaths} = this._resolvePath(arguments, arguments.length - 2)
    if (!state || state[property] === value) return;
    if (value === void 0 && Array.isArray(state)) {
      state.length -= 1;
      notify = true;
    } else {
      notify = Array.isArray(state) || !(property in state);
      if (value === void 0)
        delete state[property];
      else state[property] = value;
    }
    if (subs && subs[property] && (ref = subs[property]._self)) ref.next();
    if (notify && subs && subs._self) subs._self.next();
    for (let i = 0; i < subPaths.length; i++) subPaths[i].next();
    if (clearMutation) ImmutableState.inMutation = false;
    return this;
  }

  _resolvePath(path, length) {
    var currentState = this._state,
      currentSubs = this._nodes,
      subPaths = [],
      i = 0;
    while (i < length) {
      register(currentSubs, path[i]);
      currentSubs = currentSubs[path[i]];

      if (currentState != null) {
        if (currentSubs._clock !== clockTime) {
          currentState[path[i]] = clone(currentState[path[i]]);
          currentSubs._clock = clockTime;
          currentSubs._state = currentState[path[i]];
        }
        currentState = currentState[path[i]];
      }

      if ((currentSubs != null ? currentSubs._subTree : void 0) != null)
        subPaths.push(currentSubs._subTree);
      i++;
    }
    return {state: currentState, subs: currentSubs, subPaths};
  }

  _setProperty(property, value) {
    var ref, k;
    if (!(property in this)) this._defineProperty(property);
    value = unwrap(value);
    if ( this._state[property] === value) return;
    if (value === void 0)
      delete this._state[property];
    else this._state[property] = value;
    (ref = this._nodes[property]) != null && ref._self ? ref._self.next() : void 0;
    ref && ref._subTree ? ref._subTree.next() : void 0;
  }

  _defineProperty(property) {
    Object.defineProperty(this, property, {
      get() {
        var value = this._state[property];
        if (!S.isListening() || typeof value === 'function') return value;
        register(this._nodes, property);
        track(this._nodes, property, '_self');
        if (isObject(value) && !(value instanceof Element)) value = new Proxy(this._nodes[property], proxyTraps);
        return value;
      },
      enumerable: true
    });

    Object.defineProperty(this, property + '$', {
      get() {
        var value = this._state[property];
        if (!S.isListening()) return value;
        register(this._nodes, property);
        track(this._nodes, property, '_subTree');
        return value;
      }
    });
  }
}

ImmutableState.inMutation = false;