import { createRuntime } from 'babel-plugin-jsx-dom-expressions';
import { S, unwrap, from } from 'solid-js';

let runtime;
export default runtime = createRuntime({
  wrap(el, accessor, isAttr, fn, deep) {
    S.makeComputationNode(() => {
      let value = accessor();
      if ((value != null) && value instanceof Object) {
        if ('then' in value || 'subscribe' in value) value = from(value);
        if (typeof value === 'function' && !isAttr && !deep) {
          runtime.wrap(el, value, isAttr, fn, true);
          return;
        }
        if (isAttr) value = unwrap(value);
      }
      S.sample(() => fn(el, value));
    });
  }
});
