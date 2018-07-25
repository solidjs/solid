import S from 's-js';
import $$observable from 'symbol-observable';

function comparer(v, k, b, isArray, path, r) {
  let ref, ref1;
  const newPath = path.concat([k]);
  if (isArray && !(((v != null ? v.id : void 0) && (v != null ? v.id : void 0) === ((ref = b[k]) != null ? ref.id : void 0)) || ((v != null ? v._id : void 0) && (v != null ? v._id : void 0) === ((ref1 = b[k]) != null ? ref1._id : void 0))) || !((v != null) && ((b != null ? b[k] : void 0) != null) && (v instanceof Object))) {
    return r.push(newPath.concat([v]));
  }
  return r.push.apply(r, diff(v, b[k], newPath));
}

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

function fromPromise(promise, seed) {
  let s = S.makeDataNode(seed),
    complete = false;
  promise
    .then((value) => {
      if (complete) return;
      s.next(value);
    }).catch(err => console.error(err));

  S.cleanup(function dispose() { complete = true; });
  return () => s.current();
}

function fromObservable(observable, seed) {
  let s = S.makeDataNode(seed),
    disposable = observable.subscribe(v => s.next(v), err => console.error(err));

  S.cleanup(function dispose() {
    disposable.unsubscribe();
    disposable = null;
  });
  return () => s.current();
}

export function isObject(obj) {
  let ref;
  return obj !== null && ((ref = typeof obj) === 'object' || ref === 'function');
}

export function diff(a, b, path = []) {
  let i, k, l, len, v;
  const r = [];
  if (!isObject(a) || (b == null)) {
    if (a !== b) {
      r.push(path.concat([a]));
    }
  } else if (Array.isArray(a)) {
    for (k = i = 0, len = a.length; i < len; k = ++i) {
      v = a[k];
      if ((b != null ? b[k] : void 0) !== v) comparer(v, k, b, true, path, r);
    }
    if ((b != null ? b.length : void 0) > a.length) {
      l = a.length;
      while (l < b.length) {
        r.push(path.concat([l, void 0]));
        l++;
      }
    }
  } else {
    for (k in a) {
      v = a[k];
      if ((b != null ? b[k] : void 0) !== v)
        comparer(v, k, b, false, path, r);
    }
    for (k in b) {
      v = b[k];
      if (!(k in a))
        r.push(path.concat([k, void 0]));
    }
  }
  return r;
}

export function unwrap(item, deep) {
  let k, result, unwrapped, v;
  if (result = item != null ? item._state : void 0) return result;

  if (!deep || !isObject(item) || (typeof item === 'function') || (item instanceof Element)) return item;

  for (k in item) {
    v = item[k];
    if ((unwrapped = unwrap(v, true)) !== v) item[k] = unwrapped;
  }
  return item;
}

export function clone(v) {
  if (!isObject(v)) return v;

  if (Array.isArray(v)) return v.slice(0);

  const obj = {};
  for (let k in v) {
    obj[k] = v[k];
  }
  return obj;
}

export function from(input, seed) {
  if (isObject(input)) {
    if (typeof input === 'function') return input;
    if ($$observable in input) return fromObservable(input[$$observable](), seed);
    if ('then' in input) return fromPromise(input, seed);
  }
  throw new Error('from() input must be a function, Promise, or Observable');
}

export function select() {
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
    if (typeof selection === 'function' || 'then' in selection || 'subscribe' in selection) {
      S.makeComputationNode(mapFn1(from(selection)));
      continue;
    }
    for (let key in selection) {
      if (!(key in this)) this._defineProperty(key);
      S.makeComputationNode(mapFn2(key, from(selection[key])));
    }
  }
  return this;
}

