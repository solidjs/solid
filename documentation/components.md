# Components

Solid.js doesn't have an opinion how you want to modularize your code. You can use objects, classes, or composable functions. Since the core render routine only runs once function closures are sufficient to maintain state. The library was made in mind for Web Components though.

You could imagine making a base Component class that creates a State instance for the internal state and props, which the child then inherits. In that model Solid would look very similar to somthing like React.

```js
import S from 's-js'
import {State} from 'solid-js'

class Component {
  constructor () {
    this.state = new State({})
    this.props = new State({});
  }

  connectedCallback() {
    this.attachShadow({mode: 'open'});
    S.root(() => this.shadowRoot.appendChild(this.render());
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
import {State, root} from 'solid-js'

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
