import * as solid from 'solid-js';
import { createContext } from 'solid-js/web';

export const A = solid.createContext(0);
export const B = createContext({ deep: [1, 2] });
function shadow() {
  const createContext = () => 1;
  return createContext();
}
const NotTop = () => {
  const Inner = createContext(1);
  return Inner;
};
export { shadow, NotTop };
