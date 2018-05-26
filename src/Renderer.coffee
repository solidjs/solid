import $$observable from 'symbol-observable'
import { createRuntime } from 'babel-plugin-jsx-dom-expressions'
import Core, { isObject, unwrap } from './Core'
import Sync from './types/Sync'

export default createRuntime({
  wrapExpr: wrapExpr = (accessor, fn) -> new Sync ->
    value = accessor()
    if isObject(value)
      if 'sid' of value
        wrapExpr (=> value.value), fn
        return
      if $$observable of value
        Core.context.disposables.push((sub = value[$$observable]()).subscribe(fn).unsubscribe.bind(sub))
        return
      if 'then' of value
        value.then(fn)
        return
    fn(value)
  sanitize: unwrap
})