export abstract class AppError extends Error {
  protected constructor(
    message: string,
    public readonly code: string,
    public readonly httpStatus: number,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class PolicyViolationError extends AppError {
  constructor(
    message = "The requested action violates organizational policy.",
    httpStatus = 403,
  ) {
    super(message, "POLICY_VIOLATION", httpStatus);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to perform this action.") {
    super(message, "FORBIDDEN", 403);
  }
}

export class ApprovalRequiredError extends AppError {
  constructor(message = "A valid human approval is required.") {
    super(message, "APPROVAL_REQUIRED", 403);
  }
}

export class VerificationRequiredError extends AppError {
  constructor(message = "Identity verification is required.") {
    super(message, "VERIFICATION_REQUIRED", 403);
  }
}

export class IdempotencyConflictError extends AppError {
  constructor(message = "The idempotency key conflicts with an existing action.") {
    super(message, "IDEMPOTENCY_CONFLICT", 409);
  }
}

export class ToolNotPermittedError extends AppError {
  constructor(message = "This tool is not permitted for the current role.") {
    super(message, "TOOL_NOT_PERMITTED", 403);
  }
}

export class ToolExecutionError extends AppError {
  constructor(message = "A tool could not complete the requested operation.") {
    super(message, "TOOL_EXECUTION_FAILED", 502);
  }
}

export class ValidationError extends AppError {
  constructor(message = "The supplied input is invalid.") {
    super(message, "VALIDATION_ERROR", 400);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "The requested resource was not found.") {
    super(message, "NOT_FOUND", 404);
  }
}

export class AIProviderError extends AppError {
  constructor(
    message = "The AI provider request failed.",
    public readonly retryable = false,
    providerCode = "AI_PROVIDER_ERROR",
  ) {
    super(message, providerCode, 502);
  }
}

export class AllProvidersFailedError extends AppError {
  constructor(message = "All AI providers failed.") {
    super(message, "ALL_PROVIDERS_FAILED", 503);
  }
}

export class RateLimitError extends AppError {
  constructor(message = "Too many requests. Please try again later.") {
    super(message, "RATE_LIMIT_EXCEEDED", 429);
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(message = "Request body exceeds maximum permitted size.") {
    super(message, "PAYLOAD_TOO_LARGE", 413);
  }
}

