import { lookupContext } from '@ryansolid/s-js';

interface Context { id: symbol, initFn: Function };

export function createContext(initFn: any) {
  const id = Symbol('context');
  return { id, initFn };
}

export function useContext(context: Context) {
  return lookupContext(context.id)
}
