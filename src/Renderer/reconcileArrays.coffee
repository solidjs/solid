# Shamelessly lifted straight from SurplusJS https://github.com/adamhaile/surplus

NOMATCH = -1
NOINSERT = -2
RECONCILE_ARRAY_BATCH = 0
RECONCILE_ARRAY_BITS = 16
RECONCILE_ARRAY_INC = 1 << RECONCILE_ARRAY_BITS
RECONCILE_ARRAY_MASK = RECONCILE_ARRAY_INC - 1
# reconcile the content of parent from ns to us
# see ivi's excellent writeup of diffing arrays in a vdom library: 
# https://github.com/ivijs/ivi/blob/2c81ead934b9128e092cc2a5ef2d3cabc73cb5dd/packages/ivi/src/vdom/implementation.ts#L1187
# this code isn't identical, since we're diffing real dom nodes to nodes-or-strings, 
# but the core methodology of trimming ends and reversals, matching nodes, then using
# the longest increasing subsequence to minimize DOM ops is inspired by ivi.

export default reconcileArrays = (parent, ns, us, multiple) ->
  ulen = us.length
  nmin = 0
  nmax = ns.length - 1
  umin = 0
  umax = ulen - 1
  n = ns[nmin]
  u = us[umin]
  nx = ns[nmax]
  ux = us[umax]
  ul = nx.nextSibling
  i = undefined
  j = undefined
  k = undefined
  doloop = true
  # scan over common prefixes, suffixes, and simple reversals
  while doloop
    doloop = false
    next = false
    # common prefix, u === n
    while equable(u, n, umin, us)
      umin++
      nmin++
      if umin > umax or nmin > nmax
        next = true
        break
      u = us[umin]
      n = ns[nmin]
    if next
      continue
    # common suffix, ux === nx
    while equable(ux, nx, umax, us)
      ul = nx
      umax--
      nmax--
      if umin > umax or nmin > nmax
        next = true
        break
      ux = us[umax]
      nx = ns[nmax]
    if next
      continue
    # reversal u === nx, have to swap node forward
    while equable(u, nx, umin, us)
      doloop = true
      parent.insertBefore nx, n
      umin++
      nmax--
      if umin > umax or nmin > nmax
        next = true
        break
      u = us[umin]
      nx = ns[nmax]
    if next
      continue
    # reversal ux === n, have to swap node back
    while equable(ux, n, umax, us)
      doloop = true
      if ul == null
        parent.appendChild n
      else
        parent.insertBefore n, ul
      ul = n
      umax--
      nmin++
      if umin > umax or nmin > nmax
        next = true
        break
      ux = us[umax]
      n = ns[nmin]
    if next
      continue
  # if that covered all updates, just need to remove any remaining nodes and we're done
  if umin > umax
    # remove any remaining nodes
    while nmin <= nmax
      parent.removeChild ns[nmax]
      nmax--
    return
  # if that covered all current nodes, just need to insert any remaining updates and we're done
  if nmin > nmax
    # insert any remaining nodes
    while umin <= umax
      insertOrAppend parent, us[umin], ul, umin, us
      umin++
    return
  # simple cases don't apply, have to actually match up nodes and figure out minimum DOM ops
  # loop through nodes and mark them with a special property indicating their order
  # we'll then go through the updates and look for those properties
  # in case any of the updates have order properties left over from earlier runs, we 
  # use the low bits of the order prop to record a batch identifier.
  # I'd much rather use a Map than a special property, but Maps of objects are really
  # slow currently, like only 100k get/set ops / second
  # for Text nodes, all that matters is their order, as they're easily, interchangeable
  # so we record their positions in ntext[]
  ntext = []
  # update global batch identifer
  RECONCILE_ARRAY_BATCH = (RECONCILE_ARRAY_BATCH + 1) % RECONCILE_ARRAY_INC
  i = nmin
  j = (nmin << RECONCILE_ARRAY_BITS) + RECONCILE_ARRAY_BATCH
  while i <= nmax
    n = ns[i]
    # add or update special order property
    if n.__special_order == undefined
      Object.defineProperty n, '__special_order',
        value: j
        writable: true
    else
      n.__special_order = j
    if n instanceof Text
      ntext.push i
    i++
    j += RECONCILE_ARRAY_INC
  # now loop through us, looking for the order property, otherwise recording NOMATCH
  src = new Array(umax - umin + 1)
  utext = []
  preserved = 0
  i = umin
  while i <= umax
    u = us[i]
    if typeof u == 'string'
      utext.push i
      src[i - umin] = NOMATCH
    else if (j = u.__special_order) != undefined and (j & RECONCILE_ARRAY_MASK) == RECONCILE_ARRAY_BATCH
      j >>= RECONCILE_ARRAY_BITS
      src[i - umin] = j
      ns[j] = null
      preserved++
    else
      src[i - umin] = NOMATCH
    i++
  if preserved == 0 and nmin == 0 and nmax == ns.length - 1
    # no nodes preserved, use fast clear and append
    if multiple
      while umin <= umax
        insertOrAppend parent, us[umin], ns[0], umin, us
        umin++
      parent.removeChild(n) for n in ns
      return
    parent.textContent = ''
    while umin <= umax
      insertOrAppend parent, us[umin], null, umin, us
      umin++
    return
  # find longest common sequence between ns and us, represented as the indices 
  # of the longest increasing subsequence in src
  lcs = longestPositiveIncreasingSubsequence(src)
  # we know we can preserve their order, so march them as NOINSERT
  i = 0
  while i < lcs.length
    src[lcs[i]] = NOINSERT
    i++

  ###
            0   1   2   3   4   5   6   7
  ns    = [ n,  n,  t,  n,  n,  n,  t,  n ]
                |          /   /       /
                |        /   /       /
                +------/---/-------/----+
                     /   /       /      |
  us    = [ n,  s,  n,  n,  s,  n,  s,  n ]
  src   = [-1, -1,  4,  5, -1,  7, -1,  1 ]
  lis   = [         2,  3,      5]
                    j
  utext = [     1,          4,      6 ]
                i
  ntext = [         2,              6 ]
                    k
  ###

  # replace strings in us with Text nodes, reusing Text nodes from ns when we can do so without moving them
  utexti = 0
  lcsj = 0
  ntextk = 0
  i = 0
  j = 0
  k = 0
  while i < utext.length
    utexti = utext[i]
    # need to answer qeustion "if utext[i] falls between two lcs nodes, is there an ntext between them which we can reuse?"
    # first, find j such that lcs[j] is the first lcs node *after* utext[i]
    while j < lcs.length and (lcsj = lcs[j]) < utexti - umin
      j++
    # now, find k such that ntext[k] is the first ntext *after* lcs[j-1] (or after start, if j === 0)
    while k < ntext.length and (ntextk = ntext[k]; j != 0) and ntextk < src[lcs[j - 1]]
      k++
    # if ntext[k] < lcs[j], then we know ntext[k] falls between lcs[j-1] (or start) and lcs[j] (or end)
    # that means we can re-use it without moving it
    if k < ntext.length and (j == lcs.length or ntextk < src[lcsj])
      n = ns[ntextk]
      u = us[utexti]
      if n.data != u
        n.data = u
      ns[ntextk] = null
      us[utexti] = n
      src[utexti] = NOINSERT
      k++
    else
      # if we didn't find one to re-use, make a new Text node
      us[utexti] = document.createTextNode(us[utexti])
    i++
  # remove stale nodes in ns
  while nmin <= nmax
    n = ns[nmin]
    if n != null
      parent.removeChild n
    nmin++
  # insert new nodes
  while umin <= umax
    ux = us[umax]
    if src[umax - umin] != NOINSERT
      if ul == null
        parent.appendChild ux
      else
        parent.insertBefore ux, ul
    ul = ux
    umax--
  return

insertOrAppend = (parent, node, marker, i, us) ->
  if typeof node == 'string'
    node = us[i] = document.createTextNode(node)
  if marker == null
    parent.appendChild node
  else
    parent.insertBefore node, marker
  return

equable = (u, n, i, us) ->
  if u == n
    true
  else if typeof u == 'string' and n instanceof Text
    if n.data != u
      n.data = u
    us[i] = n
    true
  else
    false

# return an array of the indices of ns that comprise the longest increasing subsequence within ns
longestPositiveIncreasingSubsequence = (ns) ->
  seq = []
  iss = []
  l = -1
  pre = new Array(ns.length)
  i = 0
  len = ns.length
  while i < len
    n = ns[i]
    if n < 0
      i++
      continue
    j = findGreatestIndexLEQ(seq, n)
    if j != -1
      pre[i] = iss[j]
    if j == l
      l++
      seq[l] = n
      iss[l] = i
    else if n < seq[j + 1]
      seq[j + 1] = n
      iss[j + 1] = i
    i++
  i = iss[l]
  while l >= 0
    seq[l] = i
    i = pre[i]
    l--
  seq

findGreatestIndexLEQ = (seq, n) ->
  # invariant: lo is guaranteed to be index of a value <= n, hi to be >
  # therefore, they actually start out of range: (-1, last + 1)
  lo = -1
  hi = seq.length
  # fast path for simple increasing sequences
  if hi > 0 and seq[hi - 1] <= n
    return hi - 1
  while hi - lo > 1
    mid = Math.floor((lo + hi) / 2)
    if seq[mid] > n
      hi = mid
    else
      lo = mid
  lo
