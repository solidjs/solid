// Deliberate divergence from the Babel plugin (which skips all plain JSX
// identifier tags): an *imported* binding referenced only as a JSX tag must
// appear in `dependencies`, or granular HMR keeps rendering the stale module
// instance after an edit bubbles from the imported module (split-brain:
// sibling non-JSX references swap to the new instance while the tag stays
// old — reproduced as a ContextNotFoundError with a re-created context).
// Same-module component tags stay excluded: their `$$component` proxy gets a
// new identity on every re-execution, so counting them would remount
// everything on every edit.
import { Provider, Widget } from './context';
import * as NS from './helpers';

export function Local() {
  return <div />;
}

export function App() {
  // Provider: imported, JSX-tag-only -> counts. Local: same-module -> not.
  // NS: member-expression root -> counts (unchanged behavior).
  return (
    <Provider>
      <Local />
      <NS.Thing />
    </Provider>
  );
}

export function Shadowed() {
  // Shadowing local resolves first: not a module-scope dependency.
  const Widget = () => <span />;
  return <Widget />;
}
