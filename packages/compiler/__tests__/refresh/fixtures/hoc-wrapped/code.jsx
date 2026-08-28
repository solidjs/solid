import { withStyles, connect } from './hoc';

// Unregistered by default: nothing proves these HOC calls produce components
// — no in-module JSX usage (see call-expr-jsx-evidence) and no `@refresh
// component` pragma (see call-expr-pragma) — so the calls stay bare (#3090).
export const Fancy = withStyles(() => <div class="fancy" />);
export const Chained = connect(withStyles(props => <div>{props.x}</div>));
// A separately declared component is registered as usual, and the HOC call
// then closes over the registered binding.
const Plain = () => <p />;
export const Wrapped = withStyles(Plain);
