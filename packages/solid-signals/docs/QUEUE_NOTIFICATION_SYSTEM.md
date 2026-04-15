# Queue System: Notification System

## Overview
The queue notification system manages how state changes propagate through the reactive system. It's responsible for coordinating the flow of information about loading states, errors, and other state changes between different parts of the application.

## Key Components

### 1. Base Queue
The base `Queue` class handles basic notification propagation:
- Receives notifications about state changes
- Propagates notifications to parent queues
- Forms the foundation for specialized notification handling

### 2. Specialized Queues

#### ConditionalQueue
Manages notifications in boundary contexts:
- Can be enabled/disabled based on conditions
- Stores notifications when disabled
- Releases stored notifications when enabled
- Used for implementing features like suspense boundaries

Example:
```typescript
class ConditionalQueue extends Queue {
  notify(node: Effect, type: number, flags: number) {
    if (this._disabled.read()) {
      // Store notifications when disabled
      if (type === LOADING_BIT) {
        flags & LOADING_BIT ? this._pendingNodes.add(node) : this._pendingNodes.delete(node);
      }
      if (type === ERROR_BIT) {
        flags & ERROR_BIT ? this._errorNodes.add(node) : this._errorNodes.delete(node);
      }
      return true;
    }
    return super.notify(node, type, flags);
  }
}
```

#### CollectionQueue
Manages collections of effects in specific states:
- Tracks effects in loading or error states
- Controls notification propagation based on collection state
- Used for implementing features like error boundaries

Example:
```typescript
class CollectionQueue extends Queue {
  notify(node: Effect, type: number, flags: number) {
    if (!(type & this._collectionType)) return super.notify(node, type, flags);
    if (flags & this._collectionType) {
      this._nodes.add(node);
      if (this._nodes.size === 1) this._disabled.write(true);
    } else {
      this._nodes.delete(node);
      if (this._nodes.size === 0) this._disabled.write(false);
    }
    type &= ~this._collectionType;
    return type ? super.notify(node, type, flags) : true;
  }
}
```

## Notification Flow

1. **State Change**
   - An effect's state changes (loading, error, etc.)
   - It notifies its queue about the change

2. **Notification Processing**
   - The queue receives the notification
   - Handles its specific responsibilities
   - May store the notification if disabled
   - May propagate the notification to parent queues

3. **State Propagation**
   - Notifications flow up the queue hierarchy
   - Each queue can modify or filter notifications
   - State changes are properly propagated through the system

## Common Use Cases

### Loading States
- Effects can enter loading states
- Queues track and propagate loading states
- Loading boundaries can show fallback content

### Error Handling
- Effects can enter error states
- Error boundaries catch and handle errors
- Error states can be reset and retried

### Boundary Conditions
- Queues can be temporarily disabled
- Notifications are stored during disabled state
- Stored notifications are released when enabled

## Best Practices

1. **Queue Hierarchy**
   - Create appropriate queue hierarchies
   - Use specialized queues for specific needs
   - Ensure proper cleanup of queues

2. **State Management**
   - Handle loading and error states properly
   - Implement proper fallback behavior
   - Handle state resets appropriately

## Example Usage

```typescript
// Create a boundary queue
const queue = new ConditionalQueue(disabledComputation);

// Create an effect that uses the queue
const effect = new Effect(initialValue, compute, effectFn, {
  queue: queue
});

// The effect will notify the queue of state changes
effect.write(newValue, flags);
```

## Related Documentation
- See [EXECUTION_CONTROL.md](./EXECUTION_CONTROL.md) for details on how effects are executed
- See [BITWISE_OPERATIONS.md](./BITWISE_OPERATIONS.md) for details on the flag system
- See [EFFECTS.md](./EFFECTS.md) for details on effect implementation
- See [BOUNDARIES.md](./BOUNDARIES.md) for details on boundary implementation 