import Core from '../Core'

export default class Sync
  constructor: (@handler, {defer=true} = {}) ->
    @execute = @execute.bind(@)
    @execute.defer = defer
    @context = {fn: @execute, disposables: []}
    @execute()
    Core.context?.disposables.push(@dispose.bind(@))

  execute: ->
    return if @__disposed
    @clean()
    Core.setContext @context, @handler

  clean: ->
    disposable() for disposable in @context.disposables
    @context.disposables = []

  dispose: ->
    return if @__disposed
    @clean()
    @__disposed = true