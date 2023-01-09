import { describe, it, expect, test } from 'vitest'

import { createEffect, createRoot, untrack } from '../core'
import { createStore, unwrap } from '../store'
import { sharedClone } from './sharedClone'

describe('recursive effects', () => {
  it('', () => {
    const [store, setStore] = createStore({ foo: 'foo', bar: { baz: 'baz' } })

    let called = 0
    let next: any

    createRoot(() => {
      createEffect(() => {
        next = sharedClone(next, store)
        called++
      })
    })

    setStore((s) => {
      s.foo = '1'
    })

    setStore((s) => {
      s.bar.baz = '2'
    })

    expect(called).toBe(3)
  })
})
