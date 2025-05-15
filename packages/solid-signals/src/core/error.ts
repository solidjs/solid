export class NotReadyError extends Error {}

export class NoOwnerError extends Error {
  constructor() {
    super(__DEV__ ? "Context can only be accessed under a reactive root." : "");
  }
}

export class ContextNotFoundError extends Error {
  constructor() {
    super(
      __DEV__
        ? "Context must either be created with a default value or a value must be provided before accessing it."
        : ""
    );
  }
}

export class EffectError extends Error {
  constructor(effect: Function, cause: unknown) {
    super(__DEV__ ? `Uncaught error while running effect:\n\n  ${effect.toString()}\n` : "");
    this.cause = cause;
  }
}
