import Core from '../Core'
import Sync from '../types/Sync'
import Selector from '../types/Selector'
import reconcileArrays from './reconcileArrays'

isNode = (el) -> el and el.nodeName and el.nodeType

normalizeIncomingArray = (normalized, array) ->
  i = 0
  len = array.length
  while i < len
    item = array[i]
    if item instanceof Node
      normalized.push item
    else if item == null or item == true or item == false
      # matches null, undefined, true or false
      # skip
    else if Array.isArray(item)
      normalizeIncomingArray(normalized, item)
    else if typeof item == 'string'
      normalized.push item
    else
      normalized.push item.toString()
    i++
  normalized

singleExpression = (parent, accessor) ->
  current = null
  new Sync ->
    return if (value = accessor()) is current
    t = typeof value
    if t is 'string'
      return current = parent.firstChild.data = value if current
      current = parent.textContent = value
    else if 'number' is t or 'boolean' is t or value instanceof Date or value instanceof RegExp
      value = value.toString()
      return current = parent.firstChild.data = value if current
      current = parent.textContent = value
    else if not value? or t is 'boolean'
      current = parent.textContent = ''
    else if value instanceof Node
      if Array.isArray(current)
        if current.length is 0
          parent.appendChild(value);
        else if current.length is 1
          parent.replaceChild(value, current[0])
        else
          parent.textContent = ''
          parent.appendChild(value)
      else if current is '' or not current?
        parent.appendChild(value)
      else parent.replaceChild(value, parent.firstChild)
      current = value
    else if Array.isArray(value)
      array = normalizeIncomingArray([], value)
      if array.length is 0
        parent.textContent = ''
      else
        if Array.isArray(current)
          if current.length is 0
            parent.appendChild(child) for child in array
          else reconcileArrays(parent, current, array)
        else unless current
          parent.appendChild(child) for child in array
        else reconcileArrays(parent, [parent.firstChild], array)
      current = array
    else if 'sid' of value
      singleExpression(parent, -> value.value)
    else
      throw new Error("content must be Node, stringable, or array of same")

multipleExpressions = (parent, accessor) ->
  nodes = []
  new Sync ->
    marker = null
    value = accessor()
    t = typeof value
    parent = nodes[0]?.parentNode or parent
    if t is 'string' or 'number' is t or 'boolean' is t or value instanceof Date or value instanceof RegExp
      if nodes[0]?.nodeType is 3
        nodes[0].data = value.toString()
        marker = nodes[0]
      else
        value = document.createTextNode(value.toString())
        if nodes[0]
          parent.replaceChild(value, nodes[0])
        else parent.appendChild(value)
        nodes[0] = marker = value
    else if value instanceof Node
      if nodes[0]
        if nodes[0] isnt value
          parent.replaceChild(value, nodes[0])
      else parent.appendChild(value)
      nodes[0] = marker = value
    else if Array.isArray(value)
      array = normalizeIncomingArray([], value)
      if array.length
        unless nodes.length
          for child, i in array
            parent.appendChild(child)
            nodes[i] = child
          marker = nodes[i-1]
        else
          reconcileArrays(parent, nodes, array, true)
          nodes = array
          marker = nodes[nodes.length - 1]
    else if value? and 'sid' of value
      return multipleExpressions(parent, -> value.value)

    # handle nulls
    unless marker?
      if nodes[0] is parent.firstChild and nodes.length > 1 and nodes[nodes.length - 1] is parent.lastChild
        parent.textContent = '';
        value = document.createTextNode('');
        parent.appendChild(value)
        marker = nodes[0] = value
      else if nodes[0]?.nodeType is 3
        nodes[0].data = '';
        marker = nodes[0]
      else
        value = document.createTextNode('')
        if nodes[0]
          parent.replaceChild(value, nodes[0])
        else parent.appendChild(value)
        marker = nodes[0] = value

    # trim extras
    while marker isnt (node = nodes[nodes.length - 1])
      parent.removeChild(node)
      nodes.length = nodes.length - 1
    return

mapSelector = (valueAccessor, mapFn) ->
  mapped = []
  list = []
  disposables = []
  length = 0

  Core.context.disposables.push ->
    d() for d in disposables
    disposables = []
  new Selector ->
    newList = valueAccessor()

    # non-arrays
    newListUnwrapped = newList?._state or newList
    unless Array.isArray(newListUnwrapped)
      if !newListUnwrapped? or newListUnwrapped is false
        mapped = []
        list = []
        d() for d in disposables
        disposables = []
        return
      return mapped[0] if list[0] is newListUnwrapped
      d() for d in disposables
      disposables = []
      list[0] = newListUnwrapped
      return mapped[0] = Core.root (dispose) ->
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
    else if length is 0
      i = 0
      while i < newLength
        list[i] = newListUnwrapped[i]
        mapped[i] = Core.root (dispose) ->
          disposables[i] = dispose
          mapFn(newList.peek?(i) or newList[i], i)
        i++
      length = newLength
    else
      newMapped = new Array(newLength)
      tempDisposables = new Array(newLength)
      indexedItems = new Map()
      end = Math.min(length, newLength)
      # reduce from both ends
      start = 0
      start++ while start < end and newListUnwrapped[start] is list[start]

      end = length - 1
      newEnd = newLength - 1
      while end >= 0 and newEnd >= 0 and newListUnwrapped[newEnd] is list[end]
        newMapped[newEnd] = mapped[end]
        tempDisposables[newEnd] = disposables[newEnd]
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
        else disposables[i]()
        i++

      # set all new values
      j = start
      while j < newLength
        if newMapped.hasOwnProperty(j)
          mapped[j] = newMapped[j]
          disposables[i] = tempDisposables[i]
        else
          mapped[j] = Core.root (dispose) ->
            disposables[j] = dispose
            mapFn(newList.peek?(j) or newList[j], j)
        j++

      # truncate extra length
      length = mapped.length = disposables.length = newLength
      # save list for next iteration
      list = newListUnwrapped.slice(0)

    mapped

export default {
  assign: (a, b) ->
    a[k] = b[k] for k of b
    return
  wrap: (accessor, fn) -> new Sync -> fn(Core.unwrap(accessor()))
  insert: (parent, multiple, accessor) ->
    if multiple
      multipleExpressions(parent, accessor)
    else singleExpression(parent, accessor)
    return
  map: mapSelector
}