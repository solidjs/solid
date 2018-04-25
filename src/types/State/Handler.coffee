import Core from '../../Core'

DEFINED =
  '_state': true
  'on': true
  'peek': true

export default class Handler
  constructor: (@_state) ->
    @__subscriptions = new Set()
    @_child_subscriptions = {}
    @[method] = @[method].bind(@) for method in Object.keys(DEFINED)[2...]

  get: (target, property) ->
    return @[property] if DEFINED[property]
    return target[property] if not Core.context?.fn or property is 'length' or typeof property is 'symbol'
    if (value = target[property])?
      return value if Core.isFunction(value)
      if Core.isObject(value) and Object.isFrozen(value)
        value = Core.clone(value)
        target[property] = value
      value = Handler.wrap(value)
    Core.context.disposables.push(@on(property, Core.context.fn).unsubscribe)
    value

  set: (target, property, value) -> return true

  deleteProperty: (target, property) -> return true

  subscribe: (fn) ->
    @__subscriptions.add(fn)
    return {
      unsubscribe: => @__subscriptions.delete(fn)
    }

  notify: (value) ->
    if @__subscriptions.size
      @__subscriptions.forEach (sub) ->
        Core.cancelTask(sub.handle) if sub.handle?
        sub.value = value
        sub.handle = Core.queueTask(sub)

Handler.wrappers = new WeakMap()
Handler.wrap = (value) ->
  return value unless Core.isObject(value) and not (value instanceof Element)
  unless wrapper = Handler.wrappers.get(value)
    proxy = new Proxy(value, handler = new Handler(value))
    Handler.wrappers.set(value, { proxy, handler })
  else { proxy } = wrapper
  return proxy
Handler.handler = (value) ->
  return value unless Core.isObject(value) and not (value instanceof Element)
  unless wrapper = Handler.wrappers.get(value)
    proxy = new Proxy(value, handler = new Handler(value))
    Handler.wrappers.set(value, { proxy, handler })
  else { handler } = wrapper
  return handler