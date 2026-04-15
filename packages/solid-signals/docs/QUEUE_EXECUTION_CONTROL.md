# Queue System: Execution Control

## Overview
The queue system is primarily responsible for managing the execution of effects in the reactive system. While it also handles state notifications (see [QUEUE_NOTIFICATION_SYSTEM.md](./QUEUE_NOTIFICATION_SYSTEM.md)), its core purpose is to ensure effects run in the correct order, handle batching of updates, and coordinate execution across different parts of the application.

## Core Concepts

### 1. Effect Types
The system distinguishes between different types of effects:

- **Pure Effects**: Computations that derive values
- **Render Effects**: Effects that update the UI
- **User Effects**: Custom effects created by the user

### 2. Execution Queues
Each queue maintains three separate queues for different effect types:

```typescript
_queues: [Computation[], Effect[], Effect[]] = [[], [], []];
```

This separation ensures:
- Pure computations run before effects
- Render effects run before user effects
- Effects of the same type run in the order they were created

## Execution Flow

### 1. Enqueuing Effects
When an effect needs to run:

```typescript
enqueue<T extends Computation | Effect>(type: number, node: T): void {
  this._queues[0].push(node as any);
  if (type) this._queues[type].push(node as any);
  schedule();
}
```

This:
- Adds the effect to the general queue
- Adds it to its specific type queue
- Schedules execution

### 2. Execution Scheduling
Effects are executed in batches:

```typescript
flush() {
  if (this._running) return;
  this._running = true;
  try {
    while (this.run(EFFECT_PURE)) {}
    incrementClock();
    scheduled = false;
    this.run(EFFECT_RENDER);
    this.run(EFFECT_USER);
  } finally {
    this._running = false;
  }
}
```

The order is important:
1. Pure computations run first (may repeat if new computations are added)
2. Clock is incremented to mark the batch
3. Render effects run
4. User effects run

### 3. Effect Execution
Each effect type has its own execution strategy:

```typescript
run(type: number) {
  if (this._queues[type].length) {
    if (type === EFFECT_PURE) {
      runPureQueue(this._queues[type]);
      this._queues[type] = [];
    } else {
      const effects = this._queues[type] as Effect[];
      this._queues[type] = [];
      runEffectQueue(effects);
    }
  }
  // ... handle child queues
}
```

## Specialized Execution Control

### 1. Conditional Execution
Some queues can conditionally execute effects:

```typescript
class ConditionalQueue extends Queue {
  run(type: number) {
    if (type && this._disabled.read()) return;
    return super.run(type);
  }
}
```

This allows:
- Pausing effect execution based on conditions
- Resuming execution when conditions change
- Managing execution in boundary contexts

### 2. Collection-based Execution
Queues can manage execution based on collections:

```typescript
class CollectionQueue extends Queue {
  _disabled: Computation<boolean> = new Computation(false, null);
  
  run(type: number) {
    if (this._disabled.read()) return;
    return super.run(type);
  }
}
```

This enables:
- Group-based execution control
- Automatic enabling/disabling based on collection state
- Coordinated execution of related effects

## Best Practices

### 1. Effect Creation
- Use appropriate effect types
- Consider execution order requirements
- Handle cleanup properly

### 2. Queue Management
- Create appropriate queue hierarchies
- Use specialized queues when needed
- Ensure proper cleanup

### 3. Execution Control
- Batch related updates
- Handle edge cases (errors, loading states)
- Consider performance implications

## Example Usage

```typescript
// Create a queue with execution control
const queue = new Queue();

// Create different types of effects
const pureEffect = new Computation(initialValue, compute);
const renderEffect = new Effect(initialValue, compute, effectFn, { render: true });
const userEffect = new Effect(initialValue, compute, effectFn);

// Effects will be executed in the correct order
queue.enqueue(EFFECT_PURE, pureEffect);
queue.enqueue(EFFECT_RENDER, renderEffect);
queue.enqueue(EFFECT_USER, userEffect);

// Execute all effects
queue.flush();
```

## Related Documentation
- See [QUEUE_NOTIFICATION_SYSTEM.md](./QUEUE_NOTIFICATION_SYSTEM.md) for details on the secondary notification system
- See [BITWISE_OPERATIONS.md](./BITWISE_OPERATIONS.md) for details on state management
- See [EFFECTS.md](./EFFECTS.md) for details on effect implementation 