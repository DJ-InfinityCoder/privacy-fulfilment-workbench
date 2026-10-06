import { z } from "zod";
import { apiHandler } from "@/lib/api-handler";
import { ValidationError } from "@/lib/errors";
import { auditEventTypes } from "@/models/model-types";
import { listAudit } from "@/services/audit-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  requestId: z.string().trim().min(1).max(120).optional(),
  eventType: z.enum(auditEventTypes).optional(),
  status: z.enum(["ok", "error", "denied"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const GET = apiHandler(async (request) => {
  const params = new URL(request.url).searchParams;
  const parsed = querySchema.safeParse({
    requestId: params.get("requestId") ?? undefined,
    eventType: params.get("eventType") ?? undefined,
    status: params.get("status") ?? undefined,
    page: params.get("page") ?? undefined,
    pageSize: params.get("pageSize") ?? undefined,
  });
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues.map((issue) => issue.message).join("; "),
    );
  }
  return listAudit(parsed.data);
});
