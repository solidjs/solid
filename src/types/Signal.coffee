import $$observable from 'symbol-observable'
import Core, { queueTask, ignore, unwrap, root, setContext, isObject, isFunction } from '../Core'

counter = 0

class Signal
  constructor: (value) ->
    @sid = "s_#{counter++}"
    @__subscriptions = new Set()
    @__value = value
    Object.defineProperty @, 'value', {
      get: ->
        Core.context.disposables.push(@_subscribe(Core.context.exec).unsubscribe) if Core.context?.exec
        @__value
      enumerable: true
    }
    Object.defineProperty @, $$observable, {value: -> @}

  peek: -> @__value

  next: (value, notify=true) ->
    @__value = value
    @notify('next', value) if notify

  subscribe: (observer) ->
    d = @_subscribe.apply(@, arguments)
    (observer.next or observer)(@__value) unless @__value is undefined
    d

  _subscribe: (observer) ->
    if typeof observer isnt 'object' or observer is null
      observer =
        next: observer
        error: arguments[1]
        complete: arguments[2]
    @__subscriptions.add(observer)
    return {
      unsubscribe: @unsubscribe.bind(@, observer)
    }

  unsubscribe: (observer) -> @__subscriptions.delete(observer)

  notify: (type, value) ->
    return unless size = @__subscriptions.size
    i = 0
    for sub from @__subscriptions
      continue unless handler = sub[type]
      queueTask(handler, value)
      break if ++i is size
    return

  map: (fn) ->
    new Selector =>
      return if (v = @value) is undefined
      ignore => fn(v)
    , {notifyAlways: true}

  mapS: (mapFn) ->
    mapped = []
    list = []
    disposables = []
    length = 0
    signals = [] if (trackIndex = mapFn.length > 1)

    Core.context.disposables.push ->
      d() for d in disposables
      disposables = null
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
        i = 0
        while i < newLength
          list[i] = newListUnwrapped[i]
          mapped[i] = root (dispose) ->
            disposables[i] = dispose
            return mapFn(newList.peek?(i) or newList[i], signals[i] = new Signal(i), newList) if trackIndex
            mapFn(newList.peek?(i) or newList[i])
          i++
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
          tempDisposables[newEnd] = disposables[newEnd]
          tempSignals[newEnd] = signals[newEnd] if trackIndex
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
            mapped[j] = root (dispose) ->
              disposables[j] = dispose
              return mapFn(newList.peek?(j) or newList[j], signals[j] = new Signal(j), newList) if trackIndex
              mapFn(newList.peek?(j) or newList[j])
          j++

        # truncate extra length
        length = mapped.length = disposables.length = newLength
        signals.length = newLength if trackIndex
        # save list for next iteration
        list = newListUnwrapped.slice(0)

      mapped

class Stream extends Signal
  constructor: (@provider) ->
    super()
    Core.context?.disposables.push(@dispose.bind(@))

  _subscribe: ->
    oldSize = @__subscriptions.size
    disposable = super._subscribe.apply(@, arguments)
    if !oldSize and @__subscriptions.size and !@disposable
      @disposable = @provider.subscribe(super.next.bind(@))
    disposable

  unsubscribe: (fn) ->
    super(fn)
    delayed = =>
      unless @__subscriptions.size
        @disposable?.unsubscribe()
        delete @disposable
    delayed.defer = true
    queueTask(delayed)

  next: ->

  peek: ->
    unless @disposable
      @disposable = @provider.subscribe(super.next.bind(@))
    super()

  dispose: ->
    return if @__disposed
    @disposable?.unsubscribe()
    @__disposed = true

class Selector extends Signal
  constructor: (@handler, {defer, @notifyAlways} = {}) ->
    super()
    @exec = @exec.bind(@)
    @exec.defer = defer
    @disposables = []
    @pure = true
    Core.context?.disposables.push(@dispose.bind(@))

  exec: ->
    return if @__disposed
    @clean()
    is_sleeping = !@__subscriptions.size
    context = if is_sleeping then null else @
    value = setContext context, => @handler(@__value)
    return if value is undefined or (not @notifyAlways and value is @__value and not isObject(value))
    super.next(value, not @_skipNotify)

  next: ->

  peek: ->
    @exec() unless @disposables.length
    super()

  _subscribe: ->
    oldSize = @__subscriptions.size
    disposable = super._subscribe.apply(@, arguments)
    if !oldSize and @__subscriptions.size and !@disposables.length
      @_skipNotify = true
      @exec()
      delete @_skipNotify
    disposable

  unsubscribe: (fn) ->
    super(fn)
    delayed = =>
      @clean() unless @__subscriptions.size
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

export default (payload, options = {}) ->
  return new Selector(payload) if isFunction(payload)
  return new Stream(payload[$$observable]()) if $$observable of payload
  new Signal(payload, options)
