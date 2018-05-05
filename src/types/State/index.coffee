import Core from '../../Core'
import Selector from '../Selector'
import Handler from './Handler'
import methods from './methods'

setNested = (item, changes) ->
  handler = Handler.handler(item)
  isArray = Array.isArray(item)
  if arguments.length is 3
    notify = isArray or not (arguments[1] of item)
    if arguments[2] is undefined
      delete item[arguments[1]]
      item.length-- if isArray
    else item[arguments[1]] = arguments[2]
    handler.trigger(arguments[1], arguments[2], notify)
    return

  for property, value of changes
    notify = isArray or not (property of item)
    if value is undefined
      delete item[property]
    else item[property] = value
    handler.trigger(property, value, notify)
  return

export default class State
  constructor: (state) ->
    Object.defineProperties @, {
      _state: {value: state, writable: true}
      _disposables: {value: [], writable: true}
      _child_subscriptions: {value: {}, writable: true}
    }
    @_defineProperty(k) for k of @_state
    Core.context?.disposables.push(@dispose.bind(@))

  set: ->
    return console.log('Cannot update in a Selector') if Core.context?.pure
    if arguments.length is 1
      @_setProperty(property, value) for property, value of arguments[0]
      return
    current = @_state
    changes = arguments[arguments.length - 1]
    i = 0
    while i < arguments.length - 1 and (temp = current[arguments[i]])?
      current = temp
      i++
    setNested(current, changes)
    return

  replace: ->
    if arguments.length is 1
      return console.log('replace must be provided a replacement state') unless arguments[0] instanceof Object
      @replace(change) for change in Core.diff(arguments[0], @_state)
      return

    if arguments.length is 2
      @_setProperty(arguments[0], arguments[1])
      return

    current = @_state
    value = arguments[arguments.length - 1]
    property = arguments[arguments.length - 2]
    i = 0
    while i < arguments.length - 2 and (temp = current[arguments[i]])?
      current = temp
      i++
    setNested(current, property, value)
    return

  select: ->
    for selection in arguments
      if Core.isFunction(selection) or 'subscribe' of selection
        selector = if Core.isFunction(selection) then new Selector(selection) else selection
        @_disposables.push selector.subscribe (value) =>
          @replace(change...) for change in ([].concat((Core.diff(val, @_state[key], [key]) for key, val of value or {})...))
          return
        continue
      if 'then' of selection
        selection.then (value) =>
          @replace(change...) for change in ([].concat((Core.diff(val, @_state[key], [key]) for key, val of value or {})...))
          return
        continue
      for key, selector of selection
        do (key, selector) =>
          @_defineProperty(key) unless key of @
          selector = if Core.isFunction(selector) then new Selector(selector) else selector
          if 'then' of selector
            return selector.then (value) =>
              @replace(change...) for change in Core.diff(value, @_state[key], [key])
              return
          @_disposables.push selector.subscribe (value) =>
            @replace(change...) for change in Core.diff(value, @_state[key], [key])
            return
    return

  dispose: ->
    return unless @_disposables
    disposable.unsubscribe() for disposable in @_disposables
    @_disposables = null
    return

  _setProperty: (property, value) ->
    @_defineProperty(property) unless property of @
    if value is undefined
      delete @_state[property]
    else @_state[property] = value
    @trigger(property, value)

  _defineProperty: (property) ->
    Object.defineProperty @, property, {
      get: =>
        return @_state[property] unless Core.context?.fn
        if (value = @_state[property])?
          return value if Core.isFunction(value)
          if Core.isObject(value) and Object.isFrozen(value)
            value = Core.clone(value)
            @_state[property] = value
          value = Handler.wrap(value)
        Core.context.disposables.push(@on(property, Core.context.fn).unsubscribe)
        value
      enumerable: true
    }

Object.assign(State::, methods)