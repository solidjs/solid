comparer = (v, k, b, is_array, path, r) ->
  new_path = path.concat([k])
  if is_array and not ((v?.id and v?.id is b[k]?.id) or (v?._id and v?._id is b[k]?._id)) or not(v? and b?[k]? and (v instanceof Object))
    return r.push(new_path.concat([v]))
  r.push.apply(r, Core.diff(v, b[k], new_path))

export default Core = {
  context: null
  queues: {
    immediate: {
      tasks: []
      nextIndex: 0
      nextHandle: 1
    }
    deferred: {
      tasks: []
      nextIndex: 0
      nextHandle: 1
    }
  }
  clock: 0

  queueTask: (task, defer) ->
    if defer
      q = Core.queues.deferred
      unless q.tasks.length
        Promise.resolve().then -> Core.processUpdates(q); Core.clock++
      q.tasks.push(task)
      return q.nextHandle++
    Core.queues.immediate.tasks.push(task)
    Core.queues.immediate.nextHandle++

  cancelTask: (handle, defer) ->
    q = if defer then Core.queues.deferred else Core.queues.immediate
    index = handle - (q.nextHandle - q.tasks.length)
    q.tasks[index] = null if q.nextIndex <= index

  processUpdates: (q) ->
    count = 0; mark = 0
    while q.nextIndex < q.tasks.length
      unless task = q.tasks[q.nextIndex]
        q.nextIndex++
        continue
      if q.nextIndex > mark
        if count++ > 5000
          console.error 'Exceeded max task recursion'
          q.nextIndex = 0
          return q.tasks = []
        mark = q.tasks.length
      try
        task(task.value)
        task.handle = null
        task.value = null
      catch err
        console.error err
      q.nextIndex++
    q.nextIndex = 0
    q.tasks = []
    return

  run: (fn) ->
    execute = !Core.queues.immediate.tasks.length
    fn()
    Core.processUpdates(Core.queues.immediate) if execute

  setContext: (newContext, fn) ->
    context = Core.context
    Core.context = newContext
    ret = fn()
    Core.context = context
    ret

  root: (fn) ->
    Core.setContext {disposables: d = []}, ->
      fn(-> disposable() for disposable in d; d = []; return)

  ignore: (fn) ->
    { disposables } = (Core.context or {})
    Core.setContext { disposables } , fn

  isObject: (obj) -> obj isnt null and typeof obj in ['object', 'function']
  isFunction: (val) -> typeof val is 'function'

  diff: (a, b, path=[]) ->
    r = []
    if not Core.isObject(a) or not b?
      r.push(path.concat([a])) unless a is b
    else if Array.isArray(a)
      comparer(v, k, b, true, path, r) for v, k in a when b?[k] isnt v
      if b?.length > a.length
        l = a.length
        while l < b.length
          r.push(path.concat([l, undefined]))
          l++
    else
      comparer(v, k, b,false, path, r) for k, v of a when b?[k] isnt v
      r.push(path.concat([k, undefined])) for k, v of b when not (k of a)
    r

  clone: (v) ->
    return v unless Core.isObject(v)
    return v.slice(0) if Array.isArray(v)
    obj = {}
    obj[k] = v[k] for k of v
    obj

  unwrap: (item, deep) ->
    return result if result = item?._state
    return item unless deep and Core.isObject(item) and not Core.isFunction(item) and not (item instanceof Element) and not (item instanceof DocumentFragment)
    item[k] = unwrapped for k, v of item when (unwrapped = Core.unwrap(v, true)) isnt v
    item
}
