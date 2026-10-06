import { z } from "zod";
import { apiHandler } from "@/lib/api-handler";
import { getMockActor } from "@/lib/mock-auth";
import { ValidationError } from "@/lib/errors";
import { executeApprovedActions } from "@/services/action-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const executeSchema = z.object({
  kind: z.enum(["CORRECTION", "DELETION"]),
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
    const parsed = executeSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError("Execution kind must be CORRECTION or DELETION.");
    }
    return executeApprovedActions(id, parsed.data.kind, await getMockActor(id));
  })(request);
}
