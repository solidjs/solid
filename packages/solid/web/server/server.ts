import { JSX } from '../../types'
import { MountableElement } from '../types'
export * from "dom-expressions/src/server";
export function delegateEvents<T>(fn: (v?: T) => T, value?: T): void {}
export function insert<T>(
  parent: MountableElement,
  accessor: (() => T) | T,
  marker?: Node | null,
  init?: JSX.Element
) {
}
