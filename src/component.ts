type Props = { [k: string]: any }
export function setDefaults(props: Props, defaultProps: Props) {
  const propKeys = Object.keys(defaultProps);
  for (let i = 0; i < propKeys.length; i++) {
    const key = propKeys[i];
    !(key in props) && (props[key] = defaultProps[key]);
  }
}

const afterStack: Function[] = [];
function runAfter() {
  let cb;
  while(cb = afterStack.pop()) cb();
}
export function afterEffects(fn: () => void) {
  if (!afterStack.length) Promise.resolve().then(runAfter);
  afterStack.push(fn);
}