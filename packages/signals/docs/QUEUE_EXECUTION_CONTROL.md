# Queue System: Execution Control

## Overview
The current scheduler is split across several layers:

- dirty and zombie heaps for recomputation work
- queue objects for render and user effect callbacks
- optimistic lanes for transition-scoped effects
- the global flush loop that coordinates all of the above

This means the queue system is no longer just "three effect queues". Pure recomputation primarily happens through heaps, while queue objects mostly hold render and user callbacks.

## The Main Pieces

### Dirty and zombie heaps
Recomputations are driven by two heaps in `src/core/scheduler.ts`:

- `dirtyQueue` for normal invalidation work
- `zombieQueue` for work that must survive disposal boundaries until cleanup settles

These heaps are drained before normal effect queues.

### Queue and GlobalQueue
`Queue` stores two callback arrays:

```typescript
_queues: [QueueCallback[], QueueCallback[]] = [[], []];
```

Index `0` is render effects, index `1` is user effects. `Queue.run(type)` drains one queue and then recursively runs child queues.

`GlobalQueue` extends `Queue` and owns the full flush loop. It is responsible for:

- draining dirty work
- handling transition completion or stashing
- running ready lane effects
- running regular render effects
- running regular user effects

### Lanes
When an effect is enqueued while `currentOptimisticLane` is active, it does not go into the queue's local arrays. Instead it is routed to the lane's effect queues:

```typescript
if (currentOptimisticLane) {
  const lane = findLane(currentOptimisticLane);
  lane._effectQueues[type - 1].push(fn);
}
```

That is how optimistic transitions keep their render/user effects isolated until the lane is ready.

## Flush Order

At a high level, `flush()` works like this:

1. Drain the dirty heap.
2. If a transition is active, either:
   - stash queue work and continue partial processing, or
   - restore stashed work and finish the transition.
3. Finalize pure work with `finalizePureQueue()`.
4. Increment the scheduler clock.
5. Run ready lane render effects.
6. Run regular render effects.
7. Run ready lane user effects.
8. Run regular user effects.

That ordering is important:

- recomputation happens before effects
- ready transition lanes get a chance to publish effects before the regular queues
- render effects always run before user effects

## What `Queue.enqueue()` Actually Does

For render and user effects:

```typescript
enqueue(type: number, fn: QueueCallback): void {
  if (type) {
    if (currentOptimisticLane) {
      const lane = findLane(currentOptimisticLane);
      lane._effectQueues[type - 1].push(fn);
    } else {
      this._queues[type - 1].push(fn);
    }
  }
  schedule();
}
```

Notes:

- `EFFECT_PURE` is not stored in these queue arrays.
- tracked effects (`EFFECT_TRACKED`) bypass the dirty heap and enqueue a user callback directly.
- `schedule()` posts a microtask unless the global queue is already running or projection writes are active.

## Boundary Queues and Execution Gating

The specialized execution control in the current code lives in `CollectionQueue`, not `ConditionalQueue`.

`CollectionQueue.run(type)` can suppress child effect execution when a boundary is disabled:

```typescript
if (!type || (read(this._disabled) && (!_revealUsed || read(this._collapsed)))) return;
return super.run(type);
```

This is how loading/error boundaries and reveal-order coordination keep effects from running for content that is currently hidden behind fallback behavior.

## Transition Stashing

One of the biggest current behaviors that older docs missed is queue stashing during incomplete transitions.

When a transition is not complete, the global queue:

- runs effects for lanes that are already ready
- stashes regular queue callbacks into `transition._queueStash`
- clears active queues
- continues processing so committed, non-transition work can still advance

When the transition completes, the stashed queues are restored and flushed.

## Practical Takeaways

- Pure work is heap-driven, not queue-array-driven.
- Queue arrays are mainly for render/user callbacks.
- Lanes are the execution boundary for optimistic transitions.
- Boundary queues can block effect execution without blocking the entire scheduler.

## Related Documentation

- See [QUEUE_NOTIFICATION_SYSTEM.md](./QUEUE_NOTIFICATION_SYSTEM.md) for how status changes move through queue parents and boundary queues.
- See [BITWISE_OPERATIONS.md](./BITWISE_OPERATIONS.md) for the `STATUS_*` and `REACTIVE_*` masks used by the scheduler.