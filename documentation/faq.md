# FAQ

### 1. JSX without a VDOM? Is this vaporware? I've heard prominent voices like the authors of the other frameworks say this isn't possible.

It is possible when you don't have React's update model. JSX is a Template DSL like any other. Just one that is more flexible in certain ways. Inserting arbitrary JavaScript can be challenging at times, but no different than supporting spread operators. So no this isn't vapourware but an approach proven to be one of the most performant.

The real benefit comes in how extensible it is. You have the compiler working for you giving you optimal native DOM updates but you have all the freedom of a library like React to write Components using techniques like Render Props and Higher Order Components along side your reactive "hooks". Don't like how Solid's control flow works? Write your own.

### 2. How is Solid so performant?

I wish I could point to a single thing, but it really is the combination of many decisions most importantly:

1. Explicit reactivity so only the things that should be reactive are tracked.
2. Compile with initial creation in mind. Solid uses heuristics to loosen granularity to reduce the number of computations made but keep key updates granular and performant.
3. Reactive expressions are just functions. This enables "Vanishing Components" with lazy prop evaluation removing unnecessary wrappers and synchronization overhead.

These are currently unique techniques in a combination that give Solid an edge over the competition.

### 3. Is there React-Compat?

No. And there likely never will be. While the APIs are similar and components often can be moved across with minor edits, the update model is fundamentally different. React Components render over and over so code outside of Hooks works very differently. The closures and hook rules are not only unnecessary they can be used in manners that do not work here.

Vue-compat on the other hand, that'd be doable. Although there are no plans to implement currently.

### 4. Why does destructuring not work? I realized I can fix it by wrapping my whole component in a function.

Reactivity occurs on property access on Prop and Store objects. Referencing them outside of a binding or reactive computation will not be tracked. Destructuring is perfectly fine inside of those.

However, wrapping your whole component in a function is not what you want to be doing irresponsibly. Solid does not have a VDOM. So any tracked change will run the whole function again recreating everything. Don't do it.

### 5. Can you add support for class components? I find the lifecycles are easier to reason about.

It is not the intention to support class components. The lifecycles of Solid are tied to scheduling the reactive system and are artificial. You could make a class out of it I suppose but effectively all the non-event handler code is basically being run in the constructor, including the render function. It's just more syntax for an excuse to make your data less granular.

Group data and its behaviors together rather than lifecycles. This is a reactive best practice that has worked for decades.

### 6. I really dislike JSX, any chance of a Template DSL? Oh, I see you have Tagged Template Literals/HyperScript. Maybe I will use those...

Don't. I will stop you right there. We use JSX the way Svelte uses their templates, to create optimized DOM instructions. The Tagged Template Literal and HyperScript solutions may be really impressive in their own right, but unless you have a real reason like a no-build requirement they are inferior in every way. Larger bundles, slower performance, and the need for manual workaround wrapping values.

It's good to have options, but Solid's JSX is really the best solution here. A Template DSL would be great as well, albeit more restrictive, but JSX gives us so much for free. TypeScript, Existing Parsers, Syntax Highlighting, TypeScript, Prettier, Code Completion, and last and not least TypeScript.

I know other libraries have been adding support for these features but that has been an enormous effort and is still imperfect and a constant maintenance headache. This is really taking a pragmatic stance.

### 7. When do I use a Signal vs Store? Why are these different?

Stores automatically wrap nested values making it ideal for deep data structures, and for things like models. For most other things Signals are lightweight and do the job wonderfully.

As much I'd love to wrap these together as a single thing, you can't proxy primitives. Functions are the simplest interface and any reactive expression (including state access) can be wrapped in one on transport so this provides a universal API. You can name your signals and state as you choose and it stays minimal. Last thing I'd want to do is force typing `.get()` `.set()` on the end-user or even worse `.value`. At least the former can be aliased for brevity, whereas the latter is just the least terse way to call a function.

### 8. Why can I not just assign a value to Solid's Store as I can in Vue. Svelte, or MobX? Where is the 2-way binding?

Reactivity is a powerful tool but also a dangerous one. MobX knows this and introduced Strict mode and Actions to limit where/when updates occur. In Solid which deals with whole Component trees of data, I realized we can learn something from React here. You don't need to be actually immutable as long as you provide the means to have the same contract.

Being able to pass the ability to update state is arguably even more important than deciding to pass the state. So being able to separate it is important, and only possible if reading is immutable. We also don't need to pay the cost of immutability if we can still granularly update. Luckily there are tons of prior art here between ImmutableJS and Immer. Ironically Solid acts mostly as a reverse Immer with its mutable internals and immutable interface.

### 9. Can I use Solid's reactivity on its own?

Of course. While I haven't exported a standalone package it is easy to install Solid without the compiler and just use the reactive primitives. One of the benefits of granular reactivity is it is library agnostic. For that matter, almost every reactive library works this way. That is what inspired [Solid](https://github.com/solidjs/solid) and it's underlying [DOM Expressions library](https://github.com/ryansolid/dom-expressions) in the first place to make a renderer purely from the reactive system.

To list a few to try: [Solid](https://github.com/solidjs/solid), [MobX](https://github.com/mobxjs/mobx), [Knockout](https://github.com/knockout/knockout), [Svelte](https://github.com/sveltejs/svelte), [S.js](https://github.com/adamhaile/S), [CellX](https://github.com/Riim/cellx), [Derivable](https://github.com/ds300/derivablejs), [Sinuous](https://github.com/luwes/sinuous), and even recently [Vue](https://github.com/vuejs/vue). Much more goes into making a reactive library than tagging it onto a renderer like, [lit-html](https://github.com/Polymer/lit-html) for example, but it's good way to get a feel.

### 10. Does Solid have a Next.js or Material Components like library I can use?

Not to my knowledge. If you are interested in building one I'm readily available on our [Discord](https://discord.com/invite/solidjs) to help build those out. We have the fundamentals and just need to build on them.