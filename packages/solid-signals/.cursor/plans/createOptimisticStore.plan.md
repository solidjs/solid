---
name: createOptimisticStore Implementation
overview: Implement `createOptimisticStore` which combines the optimistic signal semantics (immediate updates that revert when transitions complete) with the store proxy-based reactivity system. All optimistic stores are projections, with signal-level granular optimistic behavior.
todos:
  - id: write-tests
    content: Write comprehensive test suite for createOptimisticStore
    status: completed
  - id: add-scheduler-flag
    content: Add projectionWriteActive flag to scheduler.ts
    status: completed
  - id: modify-setSignal
    content: Modify setSignal to check projectionWriteActive
    status: completed
  - id: update-projection
    content: Update projection.ts writeTraps to set projectionWriteActive
    status: completed
  - id: add-optimistic-override
    content: Add STORE_OPTIMISTIC_OVERRIDE to store.ts and modify traps to use it
    status: completed
  - id: add-reversion-tracking
    content: Add optimistic store tracking and reversion logic to scheduler
    status: completed
  - id: implement-optimistic-store
    content: Implement createOptimisticStore in optimistic.ts
    status: completed
  - id: verify-tests
    content: Run tests and verify all pass
    status: completed
isProject: false
---

# createOptimisticStore Implementation

## Overview

`createOptimisticStore` combines two existing primitives:

- **createOptimistic**: Signals that show updates immediately but revert when transitions complete
- **createStore**: Proxy-based reactive stores with fine-grained tracking

The result should allow optimistic UI patterns with complex nested data structures.

## Architecture

All optimistic stores are implemented as **projections** (even "static" ones).

**Key principles:**

- Signals are lazy - only created for observed paths
- Unobserved paths don't need multiple realities
- `STORE_VALUE` is immutable (never mutated, only replaced by reconcile)

**Two write contexts, two override layers:**

1. **Projection writes** (`projectionWriteActive = true`) → `STORE_OVERRIDE` (permanent base updates)
2. **User setter writes** (`projectionWriteActive = false`) → `STORE_OPTIMISTIC_OVERRIDE` (reverted on transition complete)

**Read priority:** `STORE_OPTIMISTIC_OVERRIDE` → `STORE_OVERRIDE` → `STORE_VALUE`

**On reversion:** Clear `STORE_OPTIMISTIC_OVERRIDE` entirely, notify existing signals

```mermaid
flowchart TD
    subgraph ProjectionRecompute [Projection Recompute]
        P1[projectionWriteActive = true]
        P2[Granular mutation OR return value]
        P3["setSignal: force non-optimistic"]
        P4[Commits normally on flush]
    end
    
    subgraph UserSetter [User Setter]
        U1[Writing.has store]
        U2[projectionWriteActive = false]
        U3["setSignal: optimistic write"]
        U4[Reverts on transition complete]
    end
    
    subgraph SignalBehavior [Signal with _optimistic = true]
        S1{projectionWriteActive?}
        S2["Write to _pendingValue (base)"]
        S3["Write to _value (immediate)"]
        S4[Save original to _pendingValue]
        S5[Track in _optimisticNodes]
    end
    
    P1 --> P2 --> P3
    U1 --> U2 --> U3
    
    S1 -->|true| S2 --> P4
    S1 -->|false| S3 --> S4 --> S5 --> U4
```

## Key Implementation Points

### 1. STORE_OPTIMISTIC_OVERRIDE Layer

Add a new store property `STORE_OPTIMISTIC_OVERRIDE` that holds optimistic writes:

- User setter writes → `STORE_OPTIMISTIC_OVERRIDE`
- Projection/reconcile writes → `STORE_OVERRIDE` (unchanged)
- Reads check: `STORE_OPTIMISTIC_OVERRIDE` → `STORE_OVERRIDE` → `STORE_VALUE`

### 2. Minimal Changes to storeTraps

Add small branches to existing traps (minimal code size impact):

**get trap:** Check optimistic override first, ~8-10 lines of new code

**set trap:** Choose target based on `projectionWriteActive` flag

**delete trap:** Same pattern as set

**has/ownKeys:** Check optimistic override in lookup chain

For non-optimistic stores: one undefined check per access (minimal overhead).

### 3. projectionWriteActive Flag (already done)

In scheduler.ts - distinguishes projection writes from user setter writes.

- `projectionWriteActive = true` → write to `STORE_OVERRIDE`
- `projectionWriteActive = false` → write to `STORE_OPTIMISTIC_OVERRIDE` (for optimistic stores)

### 4. Signal-level Tracking for Observed Paths

Signals marked with `_optimistic = true` for reactive notifications.

When `STORE_OPTIMISTIC_OVERRIDE` is cleared, notify existing signals to trigger re-reads.

### 5. Reversion Mechanism

Track optimistic stores that have been modified. On transition complete:

1. Clear `STORE_OPTIMISTIC_OVERRIDE` for tracked stores
2. Notify any existing signals to re-read from base values

### 6. All Optimistic Stores are Projections

Static stores become projections internally for consistency.

## File Changes

### [src/core/scheduler.ts](src/core/scheduler.ts) ✅

- Add `projectionWriteActive` flag and setter
- Add `optimisticStores` to Transition interface and GlobalQueue
- Add `trackOptimisticStore` function
- Update `finalizePureQueue` to clear optimistic stores
- Create new Set when stashing incomplete transitions

### [src/core/core.ts](src/core/core.ts) ✅

- Import `projectionWriteActive` from scheduler
- Modify `setSignal` to check flag

### [src/store/projection.ts](src/store/projection.ts) ✅

- Call `setProjectionWriteActive(true/false)` in writeTraps

### [src/store/store.ts](src/store/store.ts) ✅

- Add `STORE_OPTIMISTIC_OVERRIDE` constant and type
- Modify `get` trap: check optimistic override first
- Modify `set` trap: write to optimistic override when appropriate
- Modify `delete` trap: same pattern
- Modify `has`, `ownKeys`, `getOwnPropertyDescriptor`: check optimistic override
- Add `clearOptimisticStore` function and register with scheduler

### [src/store/optimistic.ts](src/store/optimistic.ts) ✅

- Implement `createOptimisticStore` with optimistic projection
- Add `optimisticWriteTraps` for projection context
- Handle both static and derived modes

## API Signatures

```typescript
// Simple optimistic store - becomes a projection internally
createOptimisticStore<T>(store: T | Store<T>): [Store<T>, StoreSetter<T>]

// Derived optimistic store  
createOptimisticStore<T>(
  fn: (store: T) => void | T | Promise<...>,
  store?: T | Store<T>,
  options?: StoreOptions
): [Store<T>, StoreSetter<T>]
```

## Test Categories

### Basic Behavior

- Store and return value on read
- Update store via setter and revert on flush
- Multiple optimistic updates before flush
- Nested object updates and reversion

### Async Transitions

- Show optimistic value during async transition
- Revert when transition completes
- Multiple sequential cycles
- Rapid successive actions (independent optimistic stores)

### Derived Stores

- Derive from source and revert optimistic writes
- Hold source during async, revert optimistic when complete
- Granular mutations in projection vs return value reconcile

### Store-specific Features

- Array operations (push, pop, splice) with reversion
- Nested object property addition/deletion
- Object.keys tracking through optimistic changes
- `in` operator behavior with overrides