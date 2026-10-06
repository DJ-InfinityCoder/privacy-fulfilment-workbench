import { AppError } from "@/lib/errors";
import { enforceBodySizeLimit, enforceRateLimit } from "@/lib/rate-limiter";

type ApiHandler<T> = (request: Request) => T | Promise<T>;
export type ApiHandlerOptions = {
  rateLimit?: number;
  rateLimitWindowMs?: number;
  maxBodyBytes?: number;
};

export function apiHandler<T>(handler: ApiHandler<T>, options?: ApiHandlerOptions) {
  return async (request: Request): Promise<Response> => {
    try {
      enforceBodySizeLimit(request, options?.maxBodyBytes);
      enforceRateLimit(request, options?.rateLimit, options?.rateLimitWindowMs);
      const data = await handler(request);
      return Response.json({ ok: true, data });
    } catch (error: unknown) {
      if (error instanceof AppError) {
        return Response.json(
          { ok: false, error: { code: error.code, message: error.message } },
          { status: error.httpStatus },
        );
      }

      console.error("Unhandled API error", error);
      return Response.json(
        {
          ok: false,
          error: {
            code: "INTERNAL_SERVER_ERROR",
            message: "An unexpected server error occurred.",
          },
        },
        { status: 500 },
      );
    }
  };
}
