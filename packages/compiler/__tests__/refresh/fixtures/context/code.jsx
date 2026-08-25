import { createContext, createSignal } from 'solid-js';

export const ThemeContext = createContext({ theme: 'light' });
const InternalContext = createContext();
// Non-componentish name still registers (createContext is matched by callee).
const lower_ctx = createContext(1);
// Not createContext: untouched.
export const S = createSignal(0);
export { InternalContext, lower_ctx };
