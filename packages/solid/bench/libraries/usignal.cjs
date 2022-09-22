// uSignal 0.7.0 https://github.com/WebReflection/usignal

'use strict';
/*! (c) Andrea Giammarchi */

const {is} = Object;

let batches;

/**
 * Execute a callback that will not side-effect until its top-most batch is
 * completed.
 * @param {() => void} callback a function that batches changes to be notified
 *  through signals.
 */
const batch = callback => {
  const prev = batches;
  batches = prev || [];
  try {
    callback();
    if (!prev)
      for (const {value} of batches);
  }
  finally { batches = prev }
};

/**
 * A signal with a value property also exposed via toJSON, toString and valueOf.
 * When created via computed, the `value` property is **readonly**.
 * @template T
 */
class Signal {
  /** @param {T} value the value carried along the signal. */
  constructor(value) {
    this._ = value;
  }

  /** @returns {T} */
  then() { return this.value }

  /** @returns {T} */
  toJSON() { return this.value }

  /** @returns {T} */
  toString() { return this.value }

  /** @returns {T} */
  valueOf() { return this.value }
}

let computedSignal;
class Computed extends Signal {
  constructor(_, v, o, f) {
    super(_);
    this.f = f;                   // is effect?
    this.$ = true;                // should update ("value for money")
    this.r = new Set;             // related signals
    this.s = new Reactive(v, o);  // signal
  }
  /** @readonly */
  get value() {
    if (this.$) {
      const prev = computedSignal;
      computedSignal = this;
      try { this.s.value = this._(this.s._) }
      finally {
        this.$ = false;
        computedSignal = prev;
      }
    }
    return this.s.value;
  }
}

const defaults = {async: false, equals: true};

/**
 * Returns a read-only Signal that is invoked only when any of the internally
 * used signals, as in within the callback, is unknown or updated.
 * @template T
 * @type {<T>(fn: (v: T) => T, value?: T, options?: { equals?: boolean | ((prev: T, next: T) => boolean) }) => Signal<T>}
 */
const computed = (fn, value, options = defaults) =>
                          new Computed(fn, value, options, false);

let outerEffect;
const noop = () => {};
class Effect extends Computed {
  constructor(_, v, o) {
    super(_, v, o, true);
    this.i = 0;         // index
    this.a = !!o.async; // async
    this.m = true;      // microtask
    this.e = [];        // effects
                        // "I am effects" ^_^;;
  }
  get value() {
    this.a ? this.async() : this.sync();
  }
  async() {
    if (this.m) {
      this.m = false;
      queueMicrotask(() => {
        this.m = true;
        this.sync();
      });
    }
  }
  sync() {
    const prev = outerEffect;
    const {e} = (outerEffect = this);
    this.i = 0;
    super.value;
    // if effects are present in loops, these can grow or shrink.
    // when these grow, there's nothing to do, as well as when these are
    // still part of the loop, as the callback gets updated anyway.
    // however, if there were more effects before but none now, those can
    // just stop being referenced and go with the GC.
    if (this.i < e.length)
      for (const effect of e.splice(this.i))
        effect.stop();
    for (const {value} of e);
    outerEffect = prev;
  }
  stop() {
    this._ = noop;
    this.r.clear();
    this.s.c.clear();
    for (const effect of this.e.splice(0))
      effect.stop();
  }
}

/**
 * Invokes a function when any of its internal signals or computed values change.
 * 
 * Returns a dispose callback.
 * @template T
 * @type {<T>(fn: (v: T) => T, value?: T, options?: { async?: boolean }) => () => void}
 */
const effect = (callback, value, options = defaults) => {
  let unique;
  if (outerEffect) {
    const {i, e} = outerEffect;
    // bottleneck:
    // there's literally no way to optimize this path *unless* the callback is
    // already a known one. however, latter case is not really common code so
    // the question is: should I optimize this more than this? 'cause I don't
    // think the amount of code needed to understand if a callback is *likely*
    // the same as before makes any sense + correctness would be trashed.
    if (i === e.length || e[i]._ !== callback)
      e[i] = new Effect(callback, value, options);
    unique = e[i];
    outerEffect.i++;
  }
  else
    (unique = new Effect(callback, value, options)).value;
  return () => { unique.stop() };
};

const skip = () => false;
class Reactive extends Signal {
  constructor(_, {equals}) {
    super(_)
    this.c = new Set;                                 // computeds
    this.s = equals === true ? is : (equals || skip); // (don't) skip updates
  }
  peek() { return this._ }
  get value() {
    if (computedSignal) {
      this.c.add(computedSignal);
      computedSignal.r.add(this);
    }
    return this._;
  }
  set value(_) {
    if (!this.s(this._, _)) {
      this._ = _;
      if (this.c.size) {
        const effects = [];
        const stack = [this];
        for (const signal of stack) {
          for (const computed of signal.c) {
            if (!computed.$ && computed.r.has(signal)) {
              computed.r.clear();
              computed.$ = true;
              if (computed.f) {
                effects.push(computed);
                const stack = [computed];
                for (const c of stack) {
                  for (const effect of c.e) {
                    effect.r.clear();
                    effect.$ = true;
                    stack.push(effect);
                  }
                }
              }
              else
                stack.push(computed.s);
            }
          }
        }
        for (const effect of effects)
          batches ? batches.push(effect) : effect.value;
      }
    }
  }
}

/**
 * Returns a writable Signal that side-effects whenever its value gets updated.
 * @template T
 * @type {<T>(initialValue: T, options?: { equals?: boolean | ((prev: T, next: T) => boolean) }) => Signal<T>}
 */
const signal = (value, options = defaults) => new Reactive(value, options);

// adapter
function createRoot(fn) { return fn(); }
function createSignal(value) {
  const r = new Reactive(value, {});
  return [() => r.value, v => r.value = v];
}

module.exports = {
  createSignal,
  createRoot,
  createComputed: effect
};