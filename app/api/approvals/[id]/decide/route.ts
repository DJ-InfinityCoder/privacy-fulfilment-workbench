import { z } from "zod";
import { apiHandler } from "@/lib/api-handler";
import { ValidationError } from "@/lib/errors";
import { requireRole } from "@/lib/mock-auth";
import { decideApproval } from "@/services/approval-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const decideSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  comment: z.string().trim().max(2000).optional(),
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
    const parsed = decideSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError("Approval decision input is invalid.");
    }
    const actor = await requireRole("approver", {
      eventType: "APPROVAL_REJECTED",
      input: { approvalId: id, decision: parsed.data.decision },
      request,
    });
    return decideApproval(
      id,
      parsed.data.decision,
      actor,
      parsed.data.comment,
    );
  })(request);
}
