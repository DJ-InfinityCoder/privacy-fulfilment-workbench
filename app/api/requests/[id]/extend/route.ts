import { z } from "zod";
import { apiHandler } from "@/lib/api-handler";
import { ValidationError } from "@/lib/errors";
import { requireRole } from "@/lib/mock-auth";
import { extendDeadline } from "@/services/request-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const extendSchema = z.object({
  reason: z.string().trim().min(1).max(2000),
});

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  return apiHandler(async () => {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ValidationError("Request body must contain valid JSON.");
    }

    const result = extendSchema.safeParse(body);
    if (!result.success) {
      throw new ValidationError(
        result.error.issues.map((issue) => issue.message).join("; "),
      );
    }

    const actor = await requireRole("approver", {
      requestId: id,
      eventType: "DEADLINE_EXTENDED",
      input: body,
      request,
    });

    return extendDeadline(id, result.data.reason, {
      actorId: actor.actorId,
      actorType: "human",
    });
  })(request);
}
