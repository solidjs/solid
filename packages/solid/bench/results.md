# Benchmark Results (22/09/2022)

This benchmark is mostly to serve Solid's own R&D. Everything is coerced to Solid's API shape as that is a necessity here. While most libraries presented are unsuitable for Solid's rendering because of missing features/capabilities it is still useful to help gauge where the implementations fall. In most UI libraries you'd be bringing in overhead from a VDOM or other rendering model where Solid's reactivity takes the brunt of that cost.

## Released Libraries

### Solid
This is Solid's production build with Transitions and Timeslicing. Look below to see equivalent pure reactive approach.

```
createDataSignals: 6
createComputations0to1: 5
createComputations1to1: 18
createComputations2to1: 16
createComputations4to1: 8
createComputations1000to1: 7
createComputations1to2: 24
createComputations1to4: 17
createComputations1to8: 17
createComputations1to1000: 33
create total: 151
---
updateComputations1to1: 31
updateComputations2to1: 20
updateComputations4to1: 15
updateComputations1000to1: 28
updateComputations1to2: 27
updateComputations1to4: 28
updateComputations1to1000: 26
update total: 176
total: 327
```

### S.js

```
createDataSignals: 4
createComputations0to1: 3
createComputations1to1: 15
createComputations2to1: 13
createComputations4to1: 15
createComputations1000to1: 16
createComputations1to2: 16
createComputations1to4: 15
createComputations1to8: 10
createComputations1to1000: 9
create total: 116
---
updateComputations1to1: 18
updateComputations2to1: 14
updateComputations4to1: 11
updateComputations1000to1: 19
updateComputations1to2: 18
updateComputations1to4: 19
updateComputations1to1000: 15
update total: 115
total: 232
```

### Kairo

```
createDataSignals: 7
createComputations0to1: 5
createComputations1to1: 19
createComputations2to1: 21
createComputations4to1: 13
createComputations1000to1: 6
createComputations1to2: 24
createComputations1to4: 16
createComputations1to8: 16
createComputations1to1000: 27
create total: 153
---
updateComputations1to1: 19
updateComputations2to1: 14
updateComputations4to1: 11
updateComputations1000to1: 13
updateComputations1to2: 22
updateComputations1to4: 20
updateComputations1to1000: 20
update total: 120
total: 273
```

### Preact Signals

```
createDataSignals: 11
createComputations0to1: 6
createComputations1to1: 18
createComputations2to1: 13
createComputations4to1: 11
createComputations1000to1: 9
createComputations1to2: 15
createComputations1to4: 14
createComputations1to8: 16
createComputations1to1000: 22
create total: 135
---
updateComputations1to1: 24
updateComputations2to1: 14
updateComputations4to1: 16
updateComputations1000to1: 20
updateComputations1to2: 21
updateComputations1to4: 21
updateComputations1to1000: 18
update total: 134
total: 269
```

### usignal

```
createDataSignals: 20
createComputations0to1: 12
createComputations1to1: 35
createComputations2to1: 23
createComputations4to1: 17
createComputations1000to1: 11
createComputations1to2: 32
createComputations1to4: 30
createComputations1to8: 51
createComputations1to1000: 54
create total: 284
---
updateComputations1to1: 50
updateComputations2to1: 31
updateComputations4to1: 23
updateComputations1000to1: 38
updateComputations1to2: 43
updateComputations1to4: 42
updateComputations1to1000: 45
update total: 272
total: 556
```

### @vue/reactivity

```
createDataSignals: 35
createComputations0to1: 14
createComputations1to1: 82
createComputations2to1: 60
createComputations4to1: 51
createComputations1000to1: 42
createComputations1to2: 60
createComputations1to4: 49
createComputations1to8: 46
createComputations1to1000: 51
create total: 491
---
updateComputations1to1: 138
updateComputations2to1: 91
updateComputations4to1: 65
updateComputations1000to1: 119
updateComputations1to2: 111
updateComputations1to4: 101
updateComputations1to1000: 107
update total: 732
total: 1222
```

### Sinuous

```
createDataSignals: 20
createComputations0to1: 53
createComputations1to1: 53
createComputations2to1: 35
createComputations4to1: 26
createComputations1000to1: 45
createComputations1to2: 51
createComputations1to4: 55
createComputations1to8: 72
createComputations1to1000: 62
create total: 472
---
updateComputations1to1: 114
updateComputations2to1: 69
updateComputations4to1: 46
updateComputations1000to1: 61
updateComputations1to2: 86
updateComputations1to4: 82
updateComputations1to1000: 87
update total: 546
total: 1018
```

## Mods of other Libraries

### S.js mod
Modified to allow conditional notification of memos

```
createDataSignals: 4
createComputations0to1: 4
createComputations1to1: 12
createComputations2to1: 7
createComputations4to1: 7
createComputations1000to1: 6
createComputations1to2: 11
createComputations1to4: 15
createComputations1to8: 10
createComputations1to1000: 17
create total: 93
---
updateComputations1to1: 27
updateComputations2to1: 17
updateComputations4to1: 11
updateComputations1000to1: 21
updateComputations1to2: 33
updateComputations1to4: 25
updateComputations1to1000: 21
update total: 155
total: 248
```

### Sinuous-mod

```
createDataSignals: 14
createComputations0to1: 25
createComputations1to1: 36
createComputations2to1: 24
createComputations4to1: 22
createComputations1000to1: 51
createComputations1to2: 37
createComputations1to4: 40
createComputations1to8: 36
createComputations1to1000: 47
create total: 332
---
updateComputations1to1: 91
updateComputations2to1: 59
updateComputations4to1: 45
updateComputations1000to1: 87
updateComputations1to2: 65
updateComputations1to4: 57
updateComputations1to1000: 71
update total: 475
total: 807
```

### RVal Mod

```
createDataSignals: 13
createComputations0to1: 29
createComputations1to1: 63
createComputations2to1: 40
createComputations4to1: 35
createComputations1000to1: 15
createComputations1to2: 62
createComputations1to4: 86
createComputations1to8: 83
createComputations1to1000: 91
create total: 517
---
updateComputations1to1: 195
updateComputations2to1: 116
updateComputations4to1: 77
updateComputations1000to1: 110
updateComputations1to2: 180
updateComputations1to4: 169
updateComputations1to1000: 164
update total: 1011
total: 1527
```

## Solid Prototypes

These are raw implementations that I use for designing Solid. Solid has overhead due to Transitions/Timeslicing and other features that are important to the framework so it's nice to look at the raw implementation. Typically it's about a 10% performance improvement.

No Array optimization is nice but adds about 30 LoC. So far I haven't seen an impact in non-reactive based benchmarks. Ie.. things that render the actual DOM so haven't implemented it.

Message approaches are faster but it have deeper callstack, and doesn't play nice with time slicing. To be fair MobX also has this call stack limitation so it isn't a big deal unless doing absurd things like the CellX benchmark.

### queue (current version of Solid)

Typical queue approach. We use a queue so we can easily support Time Slicing.

```
createDataSignals: 5
createComputations0to1: 4
createComputations1to1: 17
createComputations2to1: 15
createComputations4to1: 7
createComputations1000to1: 7
createComputations1to2: 23
createComputations1to4: 17
createComputations1to8: 17
createComputations1to1000: 31
create total: 143
---
updateComputations1to1: 26
updateComputations2to1: 19
updateComputations4to1: 13
updateComputations1000to1: 28
updateComputations1to2: 24
updateComputations1to4: 24
updateComputations1to1000: 23
update total: 158
total: 300
```

### queue-noarray

Array optimization on Queue approach

```
createDataSignals: 6
createComputations0to1: 4
createComputations1to1: 13
createComputations2to1: 8
createComputations4to1: 7
createComputations1000to1: 7
createComputations1to2: 13
createComputations1to4: 16
createComputations1to8: 11
createComputations1to1000: 10
create total: 95
---
updateComputations1to1: 24
updateComputations2to1: 17
updateComputations4to1: 14
updateComputations1000to1: 18
updateComputations1to2: 22
updateComputations1to4: 21
updateComputations1to1000: 19
update total: 136
total: 231
```

### message

Inspired by MobX algorithm.

```
createDataSignals: 5
createComputations0to1: 3
createComputations1to1: 17
createComputations2to1: 15
createComputations4to1: 7
createComputations1000to1: 7
createComputations1to2: 24
createComputations1to4: 17
createComputations1to8: 17
createComputations1to1000: 32
create total: 144
---
updateComputations1to1: 19
updateComputations2to1: 14
updateComputations4to1: 11
updateComputations1000to1: 26
updateComputations1to2: 24
updateComputations1to4: 23
updateComputations1to1000: 22
update total: 138
total: 282
```

### message-noarray
MobX algorithm inspired + array optimized. Currently this is the fastest approach I have.

```
createDataSignals: 6
createComputations0to1: 4
createComputations1to1: 13
createComputations2to1: 7
createComputations4to1: 8
createComputations1000to1: 6
createComputations1to2: 14
createComputations1to4: 17
createComputations1to8: 11
createComputations1to1000: 11
create total: 97
---
updateComputations1to1: 15
updateComputations2to1: 13
updateComputations4to1: 11
updateComputations1000to1: 18
updateComputations1to2: 20
updateComputations1to4: 21
updateComputations1to1000: 18
update total: 115
total: 212
```
