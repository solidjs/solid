import $$observable from 'symbol-observable'
import Core from '../Core'

counter = 0

export default class Signal
  constructor: (value) ->
    @sid = 's_' + counter++
    @__subscriptions = new Set()
    @__value = value
    Object.defineProperty @, 'value', {
      get: ->
        Core.context.disposables.push(@_subscribe(Core.context.fn).unsubscribe) if Core.context?.fn
        @__value
      configurable: true
    }
    Object.defineProperty @, $$observable, {value: -> @}

  peek: -> @__value

  next: (value, notify=true) ->
    @__value = value
    @notify('next', value) if notify

  subscribe: (observer) ->
    d = @_subscribe.apply(@, arguments)
    (observer.next or observer)(@__value)
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
      Core.queueTask(handler, value)
      break if ++i is size
    return