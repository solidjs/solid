import Core, { run, diff, unwrap, isFunction, isObject, clone } from '../Core'
import Signal from '../Signal'
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
      _target: {value: state, writable: true}
      _disposables: {value: [], writable: true}
      _child_subscriptions: {value: {}, writable: true}
    }
    @_defineProperty(k) for k of @_target
    Core.context?.disposables.push(@dispose.bind(@))

  set: ->
    return console.log('Cannot update in a Selector') if Core.context?.pure
    args = arguments
    run =>
      if args.length is 1
        if Array.isArray(args[0])
          @set.apply(@, change) for change in args[0]
        else @_setProperty(property, value) for property, value of args[0]
        return
      current = @_target
      changes = args[args.length - 1]
      i = 0
      while i < args.length - 1 and (temp = current[args[i]])?
        current = temp
        i++
      setNested(current, changes)
    return

  replace: ->
    if arguments.length is 1
      return console.log('replace must be provided a replacement state') unless arguments[0] instanceof Object
      changes = arguments[0]
      run =>
        changes = diff(changes, @_target) unless Array.isArray(changes)
        @replace.apply(@, change) for change in changes
        return

    if arguments.length is 2
      @_setProperty(arguments[0], arguments[1])
      return

    current = @_target
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
      if isFunction(selection) or 'then' of selection or 'subscribe' of selection
        selection = Signal(selection) unless 'sid' of selection
        @_disposables.push selection.subscribe (value) =>
          value = unwrap(value, true)
          @replace([].concat((diff(val, @_target[key], [key]) for key, val of value or {})...))
          return
        return
      for key, selector of selection
        do (key, selector) =>
          @_defineProperty(key) unless key of @
          selector = Signal(selector) unless 'sid' of selector
          @_disposables.push selector.subscribe (value) =>
            @replace(diff(unwrap(value, true), @_target[key], [key]))
            return
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
      delete @_target[property]
    else @_target[property] = value
    @trigger(property, value)

  _defineProperty: (property) ->
    Object.defineProperty @, property, {
      get: =>
        return @_target[property] unless Core.context?.exec
        if (value = @_target[property])?
          return value if isFunction(value)
          if isObject(value) and Object.isFrozen(value)
            value = clone(value)
            @_target[property] = value
          value = Handler.wrap(value)
        Core.context.disposables.push(@on(property, Core.context.exec).unsubscribe)
        value
      enumerable: true
    }

Object.assign(State::, methods)