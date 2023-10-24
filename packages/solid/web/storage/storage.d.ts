/// <reference types="node" />
import { AsyncLocalStorage } from "node:async_hooks";
import type { RequestEvent } from "../server";
export default function initializeServerStorage<T extends RequestEvent>(): AsyncLocalStorage<T>;
