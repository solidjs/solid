import Core from '../../Core'
import Handler from './Handler'

methods = {
  trigger: (property, value, notify) ->
    subs = @_child_subscriptions[property]
    if subs?.size
      subs.forEach (sub) ->
        Core.cancelTask(sub.handle) if sub.handle?
        sub.value = value
        sub.handle = Core.queueTask(sub)
    @notify(@_state) if notify

  peek: (property) ->
    value = @_state[property]
    if Core.isObject(value) and Object.isFrozen(value)
      value = Core.clone(value)
      @_state[property] = value
    Handler.wrap(value)

  on: (property, fn) ->
    value = @_state[property]
    disposable = null
    if Core.isObject(value) and not (Core.isFunction(value) or value instanceof Element)
      handler = Handler.handler(value)
      disposable = handler.subscribe(fn)
    @_child_subscriptions[property] or= new Set()
    @_child_subscriptions[property].add(fn)
    return {unsubscribe: =>
      disposable.unsubscribe() if disposable
      @_child_subscriptions[property].delete(fn)
    }
}

Object.assign(Handler::, methods)

export default methods