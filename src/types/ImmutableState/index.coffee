import Core from '../../Core'
import Selector from '../Selector'
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
    Core.run =>
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
      Core.run =>
        changes = Core.diff(changes, @_target) unless Array.isArray(changes)
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
      if Core.isFunction(selection) or 'subscribe' of selection
        selector = if Core.isFunction(selection) then new Selector(selection) else selection
        @_disposables.push selector.subscribe (value) =>
          @replace([].concat((Core.diff(val, @_target[key], [key]) for key, val of value or {})...))
          return
        continue
      if 'then' of selection
        selection.then (value) =>
          @replace([].concat((Core.diff(val, @_target[key], [key]) for key, val of value or {})...))
          return
        continue
      for key, selector of selection
        do (key, selector) =>
          @_defineProperty(key) unless key of @
          selector = if Core.isFunction(selector) then new Selector(selector) else selector
          if 'then' of selector
            return selector.then (value) =>
              @replace(Core.diff(value, @_target[key], [key]))
              return
          @_disposables.push selector.subscribe (value) =>
            @replace(Core.diff(value, @_target[key], [key]))
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
    Core.queueTask(sub, value) for sub from subs
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
          currentState[path[i]] = Core.clone(currentState[path[i]])
          currentSubs.clock = Core.clock
        currentState = currentState[path[i]]
      subPaths.push({state: currentState, subs: currentSubs._subPath}) if currentSubs?._subPath?.size
      i++
    {state: currentState, subs: currentSubs, subPaths}

  _setProperty: (property, value) ->
    @_defineProperty(property) unless property of @
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
        return @_target[property] unless Core.context?.fn
        if (value = @_target[property])? and Core.isObject(value) and not (value instanceof Element)
          return value if Core.isFunction(value)
          @_subscriptions[property] or= {clock: Core.clock}
          @_subscriptions[property].path or= [property]
          value = new Proxy(@_subscriptions[property], new ImmutableHandler(@_subscriptions[property], value, @))
        Core.context.disposables.push(@on(property, Core.context.fn).unsubscribe)
        value
      enumerable: true
    }
    Object.defineProperty @, property + '$', {
      get: =>
        if fn = Core.context.fn
          @_subscriptions[property] or= {_subs: new Set(), clock: Core.clock}
          @_subscriptions[property]._subPath or= new Set()
          @_subscriptions[property]._subPath.add(Core.context.fn)
          Core.context.disposables.push(=> @_subscriptions[property]._subPath.delete(fn))
        return @_target[property]
    }