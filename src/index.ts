export { createState, unwrap } from './state';
export { reconcile } from './reconcile';
export * from './signals';
export * from './afterRender';

export * from './context';
export * from './suspense';

// set component defaults
type Props = { [k: string]: any }
export function setDefaults(props: Props, defaultProps: Props) {
  const propKeys = Object.keys(defaultProps);
  for (let i = 0; i < propKeys.length; i++) {
    const key = propKeys[i];
    !(key in props) && (props[key] = defaultProps[key]);
  }
}

export { root as createRoot, cleanup as onCleanup, sample, freeze, setContext, getContextOwner } from '@ryansolid/s-js';
