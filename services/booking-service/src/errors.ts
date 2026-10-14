export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class ConfigurationError extends AppError {
  constructor(integration: string) {
    super(503, 'INTEGRATION_NOT_CONFIGURED', `${integration} is not configured`);
    this.name = 'ConfigurationError';
  }
}
