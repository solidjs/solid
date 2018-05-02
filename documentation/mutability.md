# Mutability

Currently this library is experimenting with 2 different ways to handle the internals of the state object. One that promotes mutable patterns (State) and one that promotes immutable (ImmutableState). Each approach has it's tradeoffs and it's important to understand their capabilities. It really comes down to the fact that in most systems once you exit a certain boundary/domain you are better off/only able to pass data by messages rather than by reference. And at that point all the performance gained by mutability is essential lost.

## Mutable State

Mutable State is definitely more performant especially over tight constant changes, although the performance in general benchmarks isn't as pronounced. The proxies are kept in a WeakMap which means that regardless of whether the value is currently wrapped or not it can always be looked up. For inbred single library/framework scenarios this works really well as no matter where you get it you can wrap it and use it. Between different state objects the same value and proxy is used and all references are the same and updated.

However interopt with other libraries is sacrificed a bit, especially ones that are immutable. While a mutable libraries expects it's inputs to be immutable (otherwise it won't be able to track the changes) once absorbed it will mutate those values at will. This is since it needs to keep object reference. Especially important for the proxies which can't change what their target it is. However to pass these values unwrapped to places which won't wrap them it is difficult to propagate changes. Perfect example is passing an object to a child Webcomponent, the prop doesn't actually change when child properties of that object change, since the reference hasn't changed. Wrapping the object in a state object in the child component solves this but assuming it is a component that doesn't use this, the responsibility of propagating the change is on the parent component. At which point the options left to you are not great. Deep cloning at each interopt point is much more expensive than just cloning to begin with. And worse the child can't count on using referential equality techniques as found in immutable data to determine change/equality.

When to use Mutable State:
* When the whole system is able to leverage this library.
* When most data communication is injected from above
* When child elements are work off simple data

## Immutable State

Immutable State seems minus performance the obvious answer then. However, there is some complexity.  First off, the thing that is being proxied no longer can be the value itself since as it changes it needs to be cloned. Instead the path is proxied, and resolution for the value and subscriptions must do a lookup from the path. Secondly deep setting requires cloning all the parent items all the way up. This requires special consideration. Thirdly the patterns for change detection in immutable data is incongruent with fine grained change detection.

To solve these challenges the library considers each execution stack a different clock cycle and as changes are applied a secondary cloned tree is set up and mutated for all the changes before being reconciled. This clock cycle is used to invalidate caches for proxied items, and makes sure that we are only cloning once per cycle to prevent wasted work.

The more interesting part comes in change detection.  Immutable data lends to iterating through the tree to detect referential inequalities and to map changes accordingly. Essentially the re-rendering you do in a Virtual DOM library. However if the change is localized this loses the information of what has changed. You need to traverse the whole tree to find the changes, whereas a mutable structure's change locality allows minimal reconcilation. Solid deals with this by encouraging more localized change through the API, and then notifying the change exactly the way it does with Mutable State pushing the propogation to the leaf nodes and not notifying the change (due to the cloning) of parent objects. In so not losing the locality even when dealing with immutable structures.

Since the change propagation works the same Mutable State the issue of the child webcomponent still holds. However it is much easier solved since path is unique and defines the item (unlike a value in a Mutable State object which might be shared). In so accessing the property with a trailing $ in a computation both returns the unwrapped value and sets up a subscription to that property and all it's descendants. This basically means that it can be broken out to plug into other Immutable libraries and other message passing scenarios by behaving like immutable atom.

When to using Immutable State:
* Concern over interopt with other systems
* Places where frequent partial updates aren't expected.