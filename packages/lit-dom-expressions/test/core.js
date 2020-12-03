import S, { root, value, sample } from "s-js";

const currentContext = null;

function memo(fn, equal) {
  if (!equal) return S(fn);
  const s = value(sample(fn));
  S(() => s(fn()));
  return s;
}

function createComponent(Comp, props) {
  if (Comp.prototype && Comp.prototype.isClassComponent) {
    return sample(() => {
      const comp = new Comp(props);
      return comp.render(props);
    });
  }
  return sample(() => Comp(props));
}

export { root, S as effect, memo, createComponent, currentContext };
