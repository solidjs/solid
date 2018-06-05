import Core, { setContext } from './Core'

export default class Sync
  constructor: (@handler, {defer=true} = {}) ->
    @exec = @exec.bind(@)
    @exec.defer = defer
    @disposables = []
    @exec()
    Core.context?.disposables.push(@dispose.bind(@))

  exec: ->
    return if @__disposed
    @clean()
    setContext @, @handler

  clean: ->
    disposable() for disposable in @disposables
    @disposables = []

  dispose: ->
    return if @__disposed
    @clean()
    @__disposed = true