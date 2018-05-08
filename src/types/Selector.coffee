import $$observable from 'symbol-observable'
import Core from '../Core'
import Signal from './Signal'

sequenceCounter = 0

export default class Selector extends Signal
  constructor: (@handler, {defer} = {}) ->
    super()
    Object.defineProperty @, 'value', {
      get: ->
        Core.context.disposables.push(@_subscribe(Core.context.fn).unsubscribe) if Core.context?.fn
        @execute() unless @context.disposables.length
        @__value
      enumerable: true
    }
    @execute = @execute.bind(@)
    @execute.defer = defer
    @context = {fn: @execute, disposables: [], pure: true}
    Core.context?.disposables.push(@dispose.bind(@))

  execute: ->
    return if @__disposed
    @seq = currentSeq = sequenceCounter++
    @clean()
    is_sleeping = !@__subscriptions.size
    context = if is_sleeping then null else @context
    new_val = Core.setContext context, => @handler(@__value)
    if new_val and Core.isObject(new_val)
      if 'then' of new_val
        new_val
          .then (new_val) =>
            return if @__disposed or @seq isnt currentSeq
            @resolve(new_val)
          .catch (err) =>
            @notify('error', err)
        return

      if $$observable of new_val
        @context.disposables.push (sub = new_val[$$observable]().subscribe(
          (val) => @resolve(val)
          (err) => @notify('error', err)
        )).unsubscribe.bind(sub)
        return
    @resolve(new_val)

  resolve: (new_val) ->
    new_val = Core.unwrap(new_val, true)
    return if new_val is @__value and not Core.isObject(new_val)
    super.next(new_val, not @_skipNotify)

  next: ->

  peek: ->
    @execute() unless @context.disposables.length
    super()

  subscribe: (observer) ->
    oldSize = @__subscriptions.size
    d = @_subscribe(arguments)
    return d unless oldSize
    (observer.next or observer)(@__value)
    d

  _subscribe: (fn) ->
    oldSize = @__subscriptions.size
    disposable = super(fn)
    if !oldSize and @__subscriptions.size and !@context.disposables.length
      @_skipNotify = true
      @execute()
      delete @_skipNotify
    disposable

  unsubscribe: (fn) ->
    super(fn)
    Core.queueTask =>
      @clean() unless @__subscriptions.size
    , true

  clean: ->
    disposable() for disposable in @context.disposables
    @context.disposables = []

  dispose: ->
    return if @__disposed
    @notify('complete')
    @clean()
    @__disposed = true

Signal::map = (fn) -> new Selector => fn(@value)