import { createRuntime } from 'babel-plugin-jsx-dom-expressions';
import { S, unwrap } from 'solid-js';

let runtime;
export default runtime = createRuntime({
  wrap(accessor, el, isAttr, fn, deep) {
    S.makeComputationNode(() => {
      let value = accessor();
      if ((value != null) && value instanceof Object) {
        if (typeof value === 'function' && !isAttr && !deep) {
          runtime.wrap(value, el, isAttr, fn, true);
          return;
        }
        if ('subscribe' in value) {
          const dispose = value.subscribe((value) => fn(value, el));
          S.cleanup('unsubscribe' in dispose ? dispose.unsubscribe.bind(dispose) : dispose);
          return;
        }
        if ('then' in value) {
          let released = false
          value.then((value) => released ? void 0 : fn(value, el));
          S.cleanup(() => released = true);
          return;
        }
        if (isAttr) value = unwrap(value);
      }
      S.sample(() => fn(value, el));
    });
  }
});
