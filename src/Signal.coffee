import $$observable from 'symbol-observable'
import Core, { setContext, queueTask, isObject, isFunction, unwrap, root, ignore } from './Core'

counter = 0
sequenceCounter = 0

fromPromise = (promise) -> {
  start: (stream) ->
    complete = false
    promise
      .then (value) =>
        return if complete
        stream._next(value)
      .catch(err) => stream._error(err)
  stop: -> complete = true
}

fromObservable = (observable) ->
  disposable = null
  return {
    start: (stream) ->
      disposable = observable.subscribe(
        (value) => stream._next(value)
        (error) => stream._error(error)
        => stream._complete()
      )
    stop: ->
      disposable.unsubscribe()
      disposable = null
  }

resolveAsync = (value, seq, obsv, fn) ->
  return fn(value) unless isObject(value)
  if 'subscribe' of value
    obsv.disposables.push(value.subscribe(fn))
    return
  if 'then' of value
    value.then (value) ->
      return if seq < obsv.seq
      fn(value)
    return
  fn(value)

rxCompat = (obsv, op) ->
  newObsv = {
    subscribe: (sub) -> op.call(sub, obsv)
    lift: (op) -> rxCompat(@, op)
  }
  Object.defineProperty newObsv, $$observable, {value: -> newObsv}
  newObsv

class Signal
  constructor: (value) ->
    @sid = "s_#{counter++}"
    @_subscriptions = new Set()
    @_value = value
    Object.defineProperty @, 'value', {
      get: ->
        Core.context.disposables.push(@_subscribe(Core.context.exec).unsubscribe) if Core.context?.exec
        @_value
      enumerable: true
    }
    Object.defineProperty @, $$observable, {value: -> @}

  peek: -> @_value

  next: (value) ->
    @_value = value
    @notify('next', value)

  error: (value) -> @notify('error', value)

  complete: -> @notify('complete')

  subscribe: (observer) ->
    d = @_subscribe.apply(@, arguments)
    (observer.next or observer).call(observer, @_value) unless @_value is undefined
    d

  _subscribe: (observer) ->
    if typeof observer isnt 'object' or observer is null
      onComplete = arguments[2]
      observer =
        next: observer
        error: arguments[1]
        complete: =>
          onComplete?()
          @unsubscribe(observer)
    @_subscriptions.add(observer)
    return {
      unsubscribe: @unsubscribe.bind(@, observer)
    }

  unsubscribe: (observer) -> @_subscriptions.delete(observer)

  notify: (type, value) ->
    return unless size = @_subscriptions.size
    i = 0
    for sub from @_subscriptions
      continue unless handler = sub[type]
      queueTask(handler.bind(sub), value)
      break if ++i is size
    return

  map: (fn) ->
    new Selector =>
      return if (v = @value) is undefined
      ignore => fn(v)
    , {notifyAlways: true}

  memo: (mapFn) ->
    mapped = []
    list = []
    disposables = []
    length = 0
    signals = [] if (trackIndex = mapFn.length > 1)

    Core.context.disposables.push ->
      d() for d in disposables
      disposables = mapped = list = signals = null

    @map (newList) =>
      # non-arrays
      newListUnwrapped = unwrap(newList, true)
      unless Array.isArray(newListUnwrapped)
        if !newListUnwrapped? or newListUnwrapped is false
          mapped = []
          list = []
          d() for d in disposables
          disposables = []
          signals = [] if trackIndex
          return null
        return mapped[0] if list[0] is newListUnwrapped
        d() for d in disposables
        disposables = []
        list[0] = newListUnwrapped
        return mapped[0] = root (dispose) ->
          disposables[0] = dispose
          mapFn(newList)

      mappedFn = (dispose) ->
        disposables[j] = dispose
        return mapFn(newList.peek?(j) or newList[j], signals[j] = new Signal(j), newList) if trackIndex
        mapFn(newList.peek?(j) or newList[j])

      newLength = newListUnwrapped.length
      if newLength is 0
        if length isnt 0
          list = []
          mapped = []
          length = 0
          d() for d in disposables
          disposables = []
          signals = [] if trackIndex
      else if length is 0
        j = 0
        while j < newLength
          list[j] = newListUnwrapped[j]
          mapped[j] = root(mappedFn)
          j++
        length = newLength
      else
        newMapped = new Array(newLength)
        tempDisposables = new Array(newLength)
        indexedItems = new Map()
        tempSignals = new Array(newLength) if trackIndex
        end = Math.min(length, newLength)
        # reduce from both ends
        start = 0
        start++ while start < end and newListUnwrapped[start] is list[start]

        end = length - 1
        newEnd = newLength - 1
        while end >= 0 and newEnd >= 0 and newListUnwrapped[newEnd] is list[end]
          newMapped[newEnd] = mapped[end]
          tempDisposables[newEnd] = disposables[end]
          tempSignals[newEnd] = signals[end] if trackIndex
          end--
          newEnd--

        # create indices
        j = newEnd
        while j >= start
          item = newListUnwrapped[j]
          itemIndex = indexedItems.get(item)
          if itemIndex?
            itemIndex.push(j)
          else
            indexedItems.set(item, [j])
          j--

        # find old items
        i = start
        while i <= end
          item = list[i]
          itemIndex = indexedItems.get(item)
          if itemIndex? and itemIndex.length > 0
            j = itemIndex.pop()
            newMapped[j] = mapped[i]
            tempDisposables[j] = disposables[i]
            tempSignals[j] = signals[i] if trackIndex
          else disposables[i]()
          i++

        # set all new values
        j = start
        while j < newLength
          if newMapped.hasOwnProperty(j)
            mapped[j] = newMapped[j]
            disposables[j] = tempDisposables[j]
            if trackIndex
              signals[j] = tempSignals[j]
              signals[j].next(j) if signals[j].peek() isnt j
          else
            mapped[j] = root(mappedFn)
          j++

        # truncate extra length
        length = mapped.length = disposables.length = newLength
        signals.length = newLength if trackIndex
        # save list for next iteration
        list = newListUnwrapped.slice(0)

      mapped

  # RxJS compatibility
  lift: (op) -> rxCompat(@, op)

  pipe: -> pipe.apply(@, arguments)(@)

class Stream extends Signal
  constructor: (@provider, {value}) ->
    super(value)
    Core.context?.disposables.push(@dispose.bind(@))

  _subscribe: ->
    oldSize = @_subscriptions.size
    disposable = super._subscribe.apply(@, arguments)
    if !oldSize and @_subscriptions.size and !@initialized
      @provider.start(@)
      @initialized = true
    disposable

  unsubscribe: (fn) ->
    super(fn)
    delayed = =>
      if @initialized and not @_subscriptions.size
        @provider.stop(@)
        delete @initialized
    delayed.defer = true
    queueTask(delayed)

  next: ->
  error: ->
  complete: ->
  _next: (value) -> super.next(value)
  _error: (value) -> super.error(value)
  _complete: -> super.complete()

  peek: ->
    unless @initialized
      @provider.start(@)
      @initialized = true
    super()

  dispose: ->
    return unless @initialized
    @provider.stop(@)
    delete @initialized

class Selector extends Signal
  constructor: (@handler, {defer, @notifyAlways, value} = {}) ->
    super(value)
    @exec = @exec.bind(@)
    @exec.defer = defer
    @disposables = []
    @pure = true
    @seq = 0
    Core.context?.disposables.push(@dispose.bind(@))

  exec: ->
    return if @__disposed
    @clean()
    is_sleeping = !@_forceAwake and !@_subscriptions.size
    context = if is_sleeping then null else @
    value = setContext context, => @handler(@_value)
    seq = ++sequenceCounter
    resolveAsync value, seq, @, (value) =>
      return if @__disposed or value is undefined or (not @notifyAlways and value is @_value and not isObject(value))
      @seq = seq
      super.next(value)

  next: ->
  error: ->
  complete: ->

  peek: ->
    @exec() unless @disposables.length
    super()

  _subscribe: ->
    unless @_subscriptions.size or @disposables.length
      @_forceAwake = true
      @exec()
      delete @_forceAwake
    super._subscribe.apply(@, arguments)

  unsubscribe: (fn) ->
    super(fn)
    delayed = =>
      @clean() unless @_subscriptions.size
    delayed.defer = true
    queueTask(delayed)

  clean: ->
    disposable() for disposable in @disposables
    @disposables = []

  dispose: ->
    return if @__disposed
    @notify('complete')
    @clean()
    @__disposed = true

export default S = (payload, options = {}) ->
  return new Signal(payload) unless payload? and isObject(payload)
  return payload if 'sid' of payload
  return new Selector(payload, options) if isFunction(payload)
  return new Stream(fromObservable(payload[$$observable]()), options) if $$observable of payload
  return new Stream(fromPromise(payload), options) if 'then' of payload
  return new Stream(payload, options) if 'start' of payload and 'stop' of payload
  new Signal(payload)

export map = (fn) -> (obsv) -> S(obsv).map(fn)

export memo = (fn) -> (obsv) -> S(obsv).memo(fn)

export pipe = (fns...) ->
  return (i => i) unless fns
  return fns[0] if fns.length is 1
  (obsv) =>
    obsv = S(obsv)
    fns.reduce ((prev, fn) => fn(prev)), obsv

