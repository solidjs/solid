# Bitwise Operations in the Reactive System

## Overview
The reactive system uses bitwise operations to efficiently track and manage various states of effects and computations. This document explains how these operations work and their purpose in the system.

## Flag Definitions

The system uses several flags to represent different states:

```typescript
// Error state flag
const ERROR_BIT = 1 << 0;      // Binary: 0001

// Loading state flag
const LOADING_BIT = 1 << 1;    // Binary: 0010

// Uninitialized state flag
const UNINITIALIZED_BIT = 1 << 2; // Binary: 0100
```

## Common Operations

### 1. Setting Flags
To set multiple flags:

```typescript
// Set error and loading flags
let flags = ERROR_BIT | LOADING_BIT; // Binary: 0011
```

### 2. Checking Flags
To check if a flag is set:

```typescript
// Check if error flag is set
if (flags & ERROR_BIT) {
  // Handle error state
}

// Check if either error or loading flag is set
if (flags & (ERROR_BIT | LOADING_BIT)) {
  // Handle error or loading state
}
```

### 3. Removing Flags
To remove a flag:

```typescript
// Remove loading flag
flags &= ~LOADING_BIT;
```

## Usage in the System

### 1. Effect States
Effects use flags to track their current state:

```typescript
// Notify queue about loading and error states
this._queue.notify(this, LOADING_BIT | ERROR_BIT, flags);
```

### 2. Boundary Conditions
Boundaries use flags to control propagation:

```typescript
// Set propagation mask for boundary
this._propagationMask = disabled ? ERROR_BIT | LOADING_BIT : 0;
```

### 3. State Management
Computations use flags to manage their state:

```typescript
// Check loading state
if (this._stateFlags & LOADING_BIT) {
  throw new NotReadyError();
}
```

## Benefits of Bitwise Operations

1. **Efficiency**
   - Single number can represent multiple states
   - Bitwise operations are very fast
   - Uses minimal memory

2. **Flexibility**
   - Easy to combine states
   - Easy to check multiple states
   - Easy to modify states

3. **Type Safety**
   - TypeScript can type-check the flags
   - Prevents invalid state combinations
   - Makes state management more predictable

## Common Flag Combinations

| Combination | Description |
|------------|-------------|
| `ERROR_BIT` | Error state only |
| `LOADING_BIT` | Loading state only |
| `ERROR_BIT | LOADING_BIT` | Both error and loading states |
| `LOADING_BIT | UNINITIALIZED_BIT` | Loading and uninitialized states |

## Best Practices

1. **Flag Definition**
   - Use powers of 2 for flag values
   - Document flag purposes
   - Keep flag names descriptive

2. **Flag Operations**
   - Use bitwise OR (`|`) to combine flags
   - Use bitwise AND (`&`) to check flags
   - Use bitwise NOT (`~`) to remove flags

3. **State Management**
   - Clear flags when no longer needed
   - Check flags before operations
   - Handle all possible flag combinations

## Example Usage

```typescript
// Create an effect with initial flags
const effect = new Effect(initialValue, compute, effectFn);

// Set multiple flags
effect.write(newValue, ERROR_BIT | LOADING_BIT);

// Check flags
if (effect._stateFlags & LOADING_BIT) {
  // Handle loading state
}

// Remove flag
effect._stateFlags &= ~ERROR_BIT;
```

## Related Documentation
- See [QUEUE_NOTIFICATION_SYSTEM.md](./QUEUE_NOTIFICATION_SYSTEM.md) for details on how flags are used in the queue system
- See [EFFECTS.md](./EFFECTS.md) for details on effect implementation
- See [BOUNDARIES.md](./BOUNDARIES.md) for details on boundary implementation 