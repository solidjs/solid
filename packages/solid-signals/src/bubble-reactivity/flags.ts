export type Flags = number

export const ERROR_OFFSET = 0
export const ERROR_BIT = 1 << ERROR_OFFSET
export const ERROR: unique symbol = Symbol('ERROR')

export const LOADING_OFFSET = 1
export const LOADING_BIT = 1 << LOADING_OFFSET
export const LOADING: unique symbol = Symbol('LOADING')

export const DEFAULT_FLAGS = ERROR_BIT
