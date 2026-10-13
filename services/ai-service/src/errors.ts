export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export class LLMError extends AppError {
  constructor(status: number, code: string, message: string, public readonly retryable = false) {
    super(status, code, message);
  }
}
