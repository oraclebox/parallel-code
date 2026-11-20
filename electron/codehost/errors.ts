/** Failures a code-host provider surfaces to the UI with an actionable kind. */

export type CodeHostErrorKind =
  | 'auth'
  | 'forbidden'
  | 'notfound'
  | 'ratelimit'
  | 'network'
  | 'config';

export class CodeHostError extends Error {
  constructor(
    readonly kind: CodeHostErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'CodeHostError';
  }
}

/** Maps an unexpected throw to a user-facing message without losing its kind. */
export function describeCodeHostError(err: unknown): string {
  if (err instanceof CodeHostError) return err.message;
  return err instanceof Error ? err.message : String(err);
}
