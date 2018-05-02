import Core from '../Core'
import Signal from './Signal'

sequenceCounter = 0

export default class Selector extends Signal
  constructor: (@handler, {defer} = {}) ->
    super()
    Object.defineProperty @, 'value', {
      get: ->
        Core.context.disposables.push(@subscribe(Core.context.fn).unsubscribe) if Core.context?.fn
        @execute() unless @context.disposables.length
        @__value
      configurable: false
      writeable: false
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
          .then (new_val) ->
            return if @__disposed or @seq isnt currentSeq
            @resolve(new_val)
          .catch (err) ->
            @notify('error', err)
        return
      # TODO check if observable
      if not ('_state' of new_val) and 'subscribe' of new_val
        @__subscribable = new_val.subscribe(
          (val) => @resolve(val)
          (err) => @notify('error', err)
          => @__subscribable?.unsubscribe()
        )
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

  subscribe: (fn) ->
    old_size = @__subscriptions.size
    disposable = super(fn)
    if !old_size and @__subscriptions.size and !@context.disposables.length
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
    @__subscribable?.unsubscribe()
    @__subscribable = null

  dispose: ->
    return if @__disposed
    @notify('complete')
    @clean()
    @__disposed = true