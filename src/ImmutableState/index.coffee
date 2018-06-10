import Core, { queueTask, clone, run, diff, unwrap, isObject, isFunction } from '../Core'
import Signal from '../Signal'
import ImmutableHandler from './ImmutableHandler'

export default class ImmutableState
  constructor: (state) ->
    Object.defineProperties @, {
      _target: {value: state, writable: true}
      _disposables: {value: [], writable: true}
      _subscriptions: {value: {}, writable: true}
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
      changes = args[args.length - 1]
      {state, subs, subPaths} = @_resolvePath(args, args.length - 1)
      return unless state
      notify = Array.isArray(state)
      for property, value of changes
        notify = notify or not (property in state)
        if value is undefined
          delete state[property]
        else state[property] = value
        @trigger(subs?[property]?._subs, value) if subs
      @trigger(subs?._subs, state) if notify
      @trigger(path.subs, path.state) for path in subPaths
      # prune subs
      if value is undefined
        delete subs[property]
      else if Array.isArray(value) and not value.length
        subKeys = ['_subs', 'clock', '_subPath']
        delete subs[property][k] for k of subs[property] when not (k in subKeys)
      return

  replace: ->
    if arguments.length is 1
      return console.log('replace must be provided a replacement state') unless arguments[0] instanceof Object
      changes = arguments[0]
      run =>
        changes = diff(changes, @_target) unless Array.isArray(changes)
        @replace.apply(@, change) for change in changes
        return
      return

    if arguments.length is 2
      @_setProperty(arguments[0], arguments[1])
      return

    value = arguments[arguments.length - 1]
    property = arguments[arguments.length - 2]
    {state, subs, subPaths} = @_resolvePath(arguments, arguments.length - 2)
    return unless state
    if value is undefined and Array.isArray(state)
      state.length -= 1
      notify = true
    else
      notify = Array.isArray(state) or not (property in state)
      if value is undefined
        delete state[property]
      else state[property] = value
    @trigger(subs[property]?._subs, value) if subs
    @trigger(subs._subs, state) if notify
    @trigger(path.subs, path.state) for path in subPaths
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

  on: (property, fn) ->
    @_subscriptions[property] or= {clock: Core.clock}
    @_subscriptions[property]._subs or= new Set()
    @_subscriptions[property]._subs.add(fn)
    return {
      unsubscribe: => @_subscriptions[property]._subs.delete(fn)
    }

  trigger: (subs, value) ->
    return unless subs?.size
    queueTask(sub, value) for sub from subs
    return

  dispose: ->
    return unless @_disposables
    disposable.unsubscribe() for disposable in @_disposables
    @_disposables = null
    return

  _resolvePath: (path, length) ->
    currentState = @_target
    currentSubs = @_subscriptions
    subPaths = []
    i = 0
    while i < length
      currentSubs[path[i]] = {} unless currentSubs[path[i]]
      currentSubs = currentSubs[path[i]]
      if currentState?
        unless currentSubs.clock is Core.clock
          currentState[path[i]] = clone(currentState[path[i]])
          currentSubs.clock = Core.clock
        currentState = currentState[path[i]]
      subPaths.push({state: currentState, subs: currentSubs._subPath}) if currentSubs?._subPath?.size
      i++
    {state: currentState, subs: currentSubs, subPaths}

  _setProperty: (property, value) ->
    @_defineProperty(property) unless property of @
    value = unwrap(value)
    if value is undefined
      delete @_target[property]
    else @_target[property] = value
    @trigger(@_subscriptions[property]?._subs, value)
    @trigger(@_subscriptions[property]?._subPath, value)
    # prune subs
    if value is undefined
      delete @_subscriptions[property]
    else if Array.isArray(value) and not value.length
      subKeys = ['_subs', 'clock', '_subPath']
      delete @_subscriptions[property][k] for k of @_subscriptions[property] when not (k in subKeys)
    return

  _defineProperty: (property) ->
    Object.defineProperty @, property, {
      get: =>
        return @_target[property] unless Core.context?.exec
        if (value = @_target[property])? and isObject(value) and not (value instanceof Element)
          return value if isFunction(value)
          @_subscriptions[property] or= {clock: Core.clock}
          @_subscriptions[property].path or= [property]
          value = new Proxy(@_subscriptions[property], new ImmutableHandler(@_subscriptions[property], value, @))
        Core.context.disposables.push(@on(property, Core.context.exec).unsubscribe)
        value
      enumerable: true
    }
    Object.defineProperty @, property + 'Signal', {
      get: =>
        if fn = Core.context.exec
          @_subscriptions[property] or= {_subs: new Set(), clock: Core.clock}
          @_subscriptions[property]._subPath or= new Set()
          @_subscriptions[property]._subPath.add(Core.context.exec)
          Core.context.disposables.push(=> @_subscriptions[property]._subPath.delete(fn))
        return @_target[property]
    }