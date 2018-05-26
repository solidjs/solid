comparer = (v, k, b, is_array, path, r) ->
  new_path = path.concat([k])
  if is_array and not ((v?.id and v?.id is b[k]?.id) or (v?._id and v?._id is b[k]?._id)) or not(v? and b?[k]? and (v instanceof Object))
    return r.push(new_path.concat([v]))
  r.push.apply(r, diff(v, b[k], new_path))

export default Core = {
  context: null
  frozen: false
  queues: {
    deferred: {
      tasks: []
      nextIndex: 0
      nextHandle: 1
    }
  }
  clock: 0
}

export queueTask = (task, value) ->
  if Core.frozen
    cancelTask(task.handle) if task.handle?
    Core.queues.current.tasks.push(task)
    task.value = value
    task.handle = Core.queues.current.nextHandle++
    return
  if task.defer
    cancelTask(task.dhandle, task.defer) if task.dhandle?
    q = Core.queues.deferred
    unless q.tasks.length
      Promise.resolve().then -> processUpdates(q); Core.clock++
    q.tasks.push(task)
    task.value = value
    task.dhandle = q.nextHandle++
    return
  task(value)
  return

export cancelTask = (handle, defer) ->
  q = if defer then Core.queues.deferred else Core.queues.current
  index = handle - (q.nextHandle - q.tasks.length)
  q.tasks[index] = null if q.nextIndex <= index

export processUpdates = (q, current) ->
  count = 0; mark = 0
  while q.nextIndex < q.tasks.length
    unless task = q.tasks[q.nextIndex]
      q.nextIndex++
      continue
    if current and task.defer
      task.handle = undefined
      queueTask(task, task.value)
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
      task.handle = task.dhandle = task.value = undefined
    catch err
      console.error err
    q.nextIndex++
  q.nextIndex = 0
  q.tasks = []
  return

export run = (fn) ->
  if !Core.frozen
    execute = true
    prevQueue = Core.queues.current
    Core.queues.current = {
      tasks: []
      nextIndex: 0
      nextHandle: 1
    }
    Core.frozen = true
  fn()
  if execute
    Core.frozen = false
    processUpdates(Core.queues.current, true)
    Core.queues.current = prevQueue
  return

export setContext = (newContext, fn) ->
  context = Core.context
  Core.context = newContext
  ret = fn()
  Core.context = context
  ret

export root = (fn) ->
  setContext {disposables: d = []}, ->
    fn(-> disposable() for disposable in d; d = []; return)

export ignore = (fn) ->
  { disposables } = (Core.context or {})
  setContext { disposables }, fn

export isObject = (obj) -> obj isnt null and typeof obj in ['object', 'function']
export isFunction = (val) -> typeof val is 'function'

export diff = (a, b, path=[]) ->
  r = []
  if not isObject(a) or not b?
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

export clone = (v) ->
  return v unless isObject(v)
  return v.slice(0) if Array.isArray(v)
  obj = {}
  obj[k] = v[k] for k of v
  obj

export unwrap = (item, deep) ->
  return result if result = item?._target
  return item unless deep and isObject(item) and not isFunction(item) and not (item instanceof Element) and not (item instanceof DocumentFragment)
  item[k] = unwrapped for k, v of item when (unwrapped = unwrap(v, true)) isnt v
  item

export resolveAsync = (value, disposables, fn) ->
  return unless isObject(value)
  if 'subscribe' of value
    disposables.push value.subscribe((val) =>
      return if resolveAsync(val, disposables, fn)
      fn(val)
    )
    return true
  if 'then' of value
    value.then(fn)
    return true

export isEqual = (a, b) -> (a?._target or a) is (b?._target or b)

