import { apiHandler } from "@/lib/api-handler";
import { ValidationError } from "@/lib/errors";
import { requireRole } from "@/lib/mock-auth";
import { overrideVerification } from "@/services/verification-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  return apiHandler(async () => {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ValidationError("Request body must contain valid JSON.");
    }

    const actor = await requireRole("approver", {
      requestId: id,
      eventType: "VERIFICATION_OVERRIDE",
      input: body,
      request,
    });

    return overrideVerification(
      id,
      body,
      actor,
    );
  })(request);
}
