import Core from '../Core'

export default class Sync
  constructor: (@handler) ->
    @execute = @execute.bind(@)
    @context = {fn: @execute, disposables: []}
    @execute()
    Core.context?.disposables.push(@dispose.bind(@))

  execute: ->
    return if @__disposed
    @clean()
    Core.setContext @context, @handler

  clean: ->
    disposable() for disposable in @context.disposables
    @context.disposables.length = 0

  dispose: ->
    return if @__disposed
    @clean()
    @__disposed = true