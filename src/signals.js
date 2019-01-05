import S from 's-js';

export function useSignal(value, comparator) {
  const d = S.makeDataNode(value);
  let setter;
  if (comparator) {
    let age = -1;
    setter = v => {
      if (!comparator(value, v)) {
        const time = d.clock().time();
        if (time === age)
          throw new Error(`Conflicting value update: ${v} is not the same as ${value}`);
        age = time;
        value = v;
        d.next(v);
      }
    }
  } else setter = d.next.bind(d);
  return [d.current.bind(d), setter];
}

export function useMemo(fn, seed) { return S(fn, seed); }

export function useEffect(fn, deps, defer) {
  if (!deps) return S.makeComputationNode(fn);
  S.on(deps, fn, undefined, defer);
}