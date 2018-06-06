import { createRuntime } from 'babel-plugin-jsx-dom-expressions'

import { Sync, onClean, unwrap } from 'solid-js'

runtime = createRuntime({
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

runtime.addEventListener = (node, eventName, fn) ->
  fn = fn.next.bind(fn) if typeof fn is 'object' and 'next' of fn
  node.addEventListener(eventName, fn)

export default runtime