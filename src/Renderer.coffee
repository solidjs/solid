import $$observable from 'symbol-observable'
import { createRuntime } from 'babel-plugin-jsx-dom-expressions'
import Core from './Core'
import Sync from './types/Sync'
import Selector from './types/Selector'

runtime = createRuntime({
  wrapExpr: (accessor, fn) -> new Sync ->
    value = accessor()
    if Core.isObject(value)
      if 'sid' of value
        new Sync -> fn(value.value)
        return
      if 'then' of value
        value.then(fn)
        return
      if $$observable of value
        Core.context.disposables.push((sub = value[$$observable]().subscribe(fn)).unsubscribe.bind(sub))
        return
    fn(value)
  sanitize: Core.unwrap
})

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

runtime.map = mapSelector

export default runtime