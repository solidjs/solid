import { withStyles, connect } from './hoc';

// Frozen plugin behavior: an inline component inside an arbitrary HOC call
// is NOT registered (only TS wrappers like `as`/`!`/`satisfies` are peeled;
// see the ts-wrapped fixture). HMR for these relies on module invalidation.
export const Fancy = withStyles(() => <div class="fancy" />);
export const Chained = connect(withStyles(props => <div>{props.x}</div>));
// A separately declared component is registered as usual, and the HOC call
// then closes over the registered binding.
const Plain = () => <p />;
export const Wrapped = withStyles(Plain);
