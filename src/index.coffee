import { ignore, root, unwrap, isEqual } from './Core'
import Signal from './types/Signal'
import Renderer from './Renderer'

export {default as State} from './types/State'
export {default as ImmutableState} from './types/ImmutableState'
export {default as Sync} from './types/Sync'

export default Object.assign(Signal, Renderer, {
  ignore, root, unwrap, isEqual
})
