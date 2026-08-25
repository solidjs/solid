import { createSignal } from 'solid-js';
import { theme } from './theme';

export const Counter = () => {
  const [count, setCount] = createSignal(0);
  return <button style={theme.button} onClick={() => setCount(count() + 1)}>{count()}</button>;
};

const Local = props => <span>{props.children}</span>;
export const Alias = Local;
export { Local };
