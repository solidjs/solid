import { createRuntime } from 'babel-plugin-jsx-dom-expressions'

import { Sync, onClean, unwrap } from 'solid-js'

export default createRuntime({
  wrapExpr: (accessor, fn) -> new Sync =>
    value = accessor()
    if value? and typeof value is 'object'
      if 'sid' of value
        new Sync => fn(value.value)
        return
      if 'subscribe' of value
        dispose = value.subscribe(fn)
        onClean(if 'unsubscribe' of dispose then dispose.unsubscribe.bind(dispose) else dispose)
        return
      if 'then' of value
        value.then(fn)
        return
    fn(value)
  sanitize: unwrap
})