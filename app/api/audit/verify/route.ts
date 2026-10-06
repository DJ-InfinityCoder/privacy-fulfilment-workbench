import { apiHandler } from "@/lib/api-handler";
import { verifyAuditChain } from "@/services/audit-service";
import { ValidationError } from "@/lib/errors";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = apiHandler(async (request) => {
  const parsed = z.object({
    requestId: z.string().trim().min(1).max(120).optional(),
  }).safeParse({
    requestId: new URL(request.url).searchParams.get("requestId") ?? undefined,
  });
  if (!parsed.success) {
    throw new ValidationError("Audit verification query is invalid.");
  }
  return verifyAuditChain(parsed.data.requestId);
});
