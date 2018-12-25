# Components

Solid.js doesn't have an opinion how you want to modularize your code. You can use objects, classes, or composable functions. Since the core render routine only runs once function closures are sufficient to maintain state. The library was made in mind for Web Components though.

You could imagine making a base Component class that creates a State instance for the internal state and props, which the child then inherits. In that model Solid would look very similar to something like React.

```jsx
import { useState, root } from 'solid-js'

class Component {
  constructor () {
    const [state, setState] = useState({}),
      [props, setProps] = useState({});
    Object.assign(this, { state, setState, props, _setProps: setProps });
  }

  connectedCallback() {
    this.attachShadow({mode: 'open'});
    root(() => this.shadowRoot.appendChild(this.render());
  }

  attributeChangedCallback(attr, oldVal, newVal) {
    this._setProps({[attr]: newVal});
  }
}

class MyComponent extends Component {
  constuctor () {
    this.setState({greeting: 'World'});
  }
  render() {
    return <div>Hello {(state.greeting)}</div>
  }
}
```

But functional composition is just as fair game.

```jsx
import { useState, root } from 'solid-js'

function Component(fn) {
  const [state, setState] = useState({}),
    [props] = useState({});
  return fn({state, setState, props});
}

function MyComponent({state, setState}) {
  setState({greeting: 'World'});
  return <div>Hello {(state.greeting)}</div>;
}

root(() => element.appendChild(Component(MyComponent)));
```
