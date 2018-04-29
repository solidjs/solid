import Core from '../../Core'

DEFINED =
  '_state': true
  'peek': true
  'map': true

export default class ImmutableHandler
  constructor: (target, @_state, @root) ->
    @peek = @peek.bind(@, target)
    @map = @map.bind(@, target) if Array.isArray(@_state)
    @stateClock = target.clock or Core.clock

  get: (target, property) ->
    @resolveState(target) if @stateClock < target.clock
    return @_state[property] if property is 'length' or typeof property is 'symbol'
    if property.endsWith('$')
      property = property[...-1]
      if Core.context.fn
        target[property] or= {_subs: new Set(), clock: Core.clock}
        target[property]._subPath or= new Set()
        target[property]._subPath.add(Core.context.fn)
        Core.context.disposables.push(target[property]._subPath.delete(Core.context.fn))
      return @_state[property]
    return @[property] if DEFINED[property]
    return @_state[property] unless Core.context?.fn
    if (value = @_state[property])? and Core.isObject(value) and not (value instanceof Element)
      return value if Core.isFunction(value)
      target[property] or= {clock: Core.clock}
      target[property].path or= target.path.concat([property])
      value = new Proxy(target[property], new ImmutableHandler(target[property], value, @root))
    Core.context.disposables.push(@subscribe(target, property, Core.context.fn).unsubscribe)
    value

  set: (target, property, value) -> return true

  deleteProperty: (target, property) -> return true

  subscribe: (target, property, fn) ->
    target[property] or= {clock: Core.clock}
    target[property]._subs or= new Set()
    target[property]._subs.add(fn)
    return {
      unsubscribe: ->  target[property]._subs.delete(fn)
    }

  peek: (target, property) ->
    @resolveState(target) if @stateClock < target.clock
    value = @_state[property]
    return value if not value? or Core.isFunction(value) or not Core.isObject(value) or (value instanceof Element)
    target[property] or= {}
    target[property].path or= target.path.concat([property])
    new Proxy(target[property], new ImmutableHandler(target[property], value, @root))

  map: (target, fn) ->
    @resolveState(target) if @stateClock < target.clock

    @_state.map (value, i, a) =>
      unless not value? or Core.isFunction(value) or not Core.isObject(value) or (value instanceof Element)
        target[i] or= {}
        target[i].path or= target.path.concat([i])
        value = new Proxy(target[i], new ImmutableHandler(target[i], value, @root))
      fn(value, i, a)

  resolveState: (target) ->
    current = @root._state
    i = 0
    l = target.path.length
    while i < l
      current = current[target.path[i]] if current
      i++
    @_state = current
    @stateClock = Core.clock