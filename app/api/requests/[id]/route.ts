import { apiHandler } from "@/lib/api-handler";
import { ValidationError } from "@/lib/errors";
import { getRequestById } from "@/services/request-service";
import { transitionRequestStatus } from "@/services/state-machine";
import { requestStatuses } from "@/models/model-types";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const transitionSchema = z.object({
  status: z.enum(requestStatuses),
});

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  return apiHandler(async () => getRequestById(id))(request);
}

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  return apiHandler(async () => {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ValidationError("Request body must contain valid JSON.");
    }

    const result = transitionSchema.safeParse(body);
    if (!result.success) {
      throw new ValidationError(
        result.error.issues.map((issue) => issue.message).join("; "),
      );
    }

    return transitionRequestStatus(id, result.data.status, {
      actorId: request.headers.get("x-actor-id")?.trim() || "privacy-ops",
      actorType: "human",
    });
  })(request);
}
