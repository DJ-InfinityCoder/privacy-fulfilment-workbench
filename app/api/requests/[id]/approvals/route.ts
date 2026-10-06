import { z } from "zod";
import { apiHandler } from "@/lib/api-handler";
import { getMockActor } from "@/lib/mock-auth";
import { ValidationError } from "@/lib/errors";
import { requestApproval } from "@/services/approval-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const requestApprovalSchema = z.object({
  kind: z.enum(["PLAN", "CORRECTION", "DELETION", "EXPORT"]),
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
    const parsed = requestApprovalSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError("A valid approval kind is required.");
    }
    return requestApproval(id, parsed.data.kind, await getMockActor(id));
  })(request);
}
