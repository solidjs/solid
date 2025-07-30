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

export class ImpureWriteError extends Error {
  constructor() {
    super(__DEV__ ? "Cannot write to a Signal in an owned scope." : "");
  }
}
