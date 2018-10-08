# Components

Solid.js doesn't have an opinion how you want to modularize your code. You can use objects, classes, or composable functions. Since the core render routine only runs once function closures are sufficient to maintain state. The library was made in mind for Web Components though.

You could imagine making a base Component class that creates a State instance for the internal state and props, which the child then inherits. In that model Solid would look very similar to somthing like React.

```js
class Component {
  constructor () {
    this.state = new State({})
    this.props = new State({});
  }

  connectedCallback() {
    this.attachShadow({mode: 'open'});
    root(() => this.shadowRoot.appendChild(this.render());
  }

  attributeChangedCallback(attr, oldVal, newVal) {
    this.props.replace(attr, newVal);
  }
}

class MyComponent extends Component {
  constuctor () {
    this.state.set({greeting: 'World'});
  }
  render() {
    return <div>Hello {state.greeting}</div>
  }
}
```

But functional composition is just as fair game.

```js
function Component(fn) {
  state = new State({});
  props = new State({});
  fn({state, props});
}

function MyComponent({state}) {
  state.set({greeting: 'World'});
  return <div>Hello {state.greeting}</div>;
}

root(() => element.appendChild(Component(MyComponent)));
```

You can also use S.js `S.data` or `S.value` signals directly, and are not required to use Solid's `State` mechanism. As an example, the following will show a count of ticking seconds:

```js
import S fromn 's-js'

const seconds = S.value(0)
const div = <div>Number of seconds elapsed: {seconds}</div>

setInterval(() => seconds(seconds() + 1), 1000)
S.root(() => document.body.appendChild(div))
```
