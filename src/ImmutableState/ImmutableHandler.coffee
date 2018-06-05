import Core, { isFunction, isObject } from '../Core'

DEFINED =
  '_target': true
  'on': true
  'peek': true
  'map': true

export default class ImmutableHandler
  constructor: (target, @_target, @root) ->
    @peek = @peek.bind(@, target)
    @on = @on.bind(@, target)
    @map = @map.bind(@, target) if Array.isArray(@_target)
    @stateClock = target.clock or Core.clock

  get: (target, property) ->
    @resolveState(target) if @stateClock < target.clock
    return @_target[property] if property is 'length' or typeof property is 'symbol'
    if property.endsWith('$')
      property = property[...-1]
      if Core.context.exec
        target[property] or= {_subs: new Set(), clock: Core.clock}
        target[property]._subPath or= new Set()
        target[property]._subPath.add(Core.context.exec)
        Core.context.disposables.push(target[property]._subPath.delete(Core.context.exec))
      return @_target[property]
    return @[property] if DEFINED[property]
    return @_target[property] unless Core.context?.exec
    if (value = @_target[property])? and isObject(value) and not (value instanceof Element)
      return value if isFunction(value)
      target[property] or= {clock: Core.clock}
      target[property].path or= target.path.concat([property])
      value = new Proxy(target[property], new ImmutableHandler(target[property], value, @root))
    Core.context.disposables.push(@on(property, Core.context.exec).unsubscribe)
    value

  set: (target, property, value) -> return true

  deleteProperty: (target, property) -> return true

  on: (target, property, fn) ->
    target[property] or= {clock: Core.clock}
    target[property]._subs or= new Set()
    target[property]._subs.add(fn)
    return {
      unsubscribe: ->  target[property]._subs.delete(fn)
    }

  peek: (target, property) ->
    @resolveState(target) if @stateClock < target.clock
    value = @_target[property]
    return value if not value? or isFunction(value) or not isObject(value) or (value instanceof Element)
    target[property] or= {}
    target[property].path or= target.path.concat([property])
    new Proxy(target[property], new ImmutableHandler(target[property], value, @root))

  map: (target, fn) ->
    @resolveState(target) if @stateClock < target.clock

    @_target.map (value, i, a) =>
      unless not value? or isFunction(value) or not isObject(value) or (value instanceof Element)
        target[i] or= {}
        target[i].path or= target.path.concat([i])
        value = new Proxy(target[i], new ImmutableHandler(target[i], value, @root))
      fn(value, i, a)

  resolveState: (target) ->
    current = @root._target
    i = 0
    l = target.path.length
    while i < l
      current = current[target.path[i]] if current
      i++
    @_target = current
    @stateClock = Core.clock