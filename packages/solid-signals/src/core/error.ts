export class NotReadyError extends Error {
  constructor(public _source: any) {
    super();
  }
}

export class StatusError extends Error {
  constructor(public _source: any, original: any) {
    super(original instanceof Error ? original.message : String(original), {
      cause: original
    });
  }
}

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
