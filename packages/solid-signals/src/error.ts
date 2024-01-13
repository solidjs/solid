export class NotReadyError extends Error {}

export interface ErrorHandler {
  (error: unknown): void;
}
