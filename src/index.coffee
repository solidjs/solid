import Core from './Core'
import Renderer from './Renderer'

export {default as State} from './types/State'
export {default as ImmutableState} from './types/ImmutableState'
export {default as Signal} from './types/Signal'
export {default as Selector} from './types/Selector'
export {default as Sync} from './types/Sync'

export default Object.assign({
  ignore: Core.ignore.bind(Core)
  root: Core.root.bind(Core)
  unwrap: Core.unwrap.bind(Core)
}, Renderer)
