import { z } from "zod";
import { apiHandler } from "@/lib/api-handler";
import { ValidationError } from "@/lib/errors";
import { createRequest, listRequests } from "@/services/request-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getActor(request: Request) {
  return {
    actorId: request.headers.get("x-actor-id")?.trim() || "privacy-ops",
    actorType: "human" as const,
  };
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ValidationError("Request body must contain valid JSON.");
  }
}

export const POST = apiHandler(async (request) => {
  const body = await readJson(request);
  return createRequest(body, getActor(request));
});

export const GET = apiHandler(async (request) => {
  const params = new URL(request.url).searchParams;
  const filtersSchema = z.object({
    status: z.string().max(200).optional(),
    type: z.enum(["ACCESS", "CORRECTION", "DELETION"]).optional(),
    deadlineState: z.enum(["ON_TRACK", "AT_RISK", "OVERDUE"]).optional(),
    search: z.string().trim().max(200).optional(),
    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(100).optional(),
  });
  const parsedFilters = filtersSchema.safeParse({
    status: params.get("status") ?? undefined,
    type: params.get("type") ?? undefined,
    deadlineState: params.get("deadlineState") ?? undefined,
    search: params.get("search") ?? undefined,
    page: params.get("page") ?? undefined,
    pageSize: params.get("pageSize") ?? undefined,
  });
  if (!parsedFilters.success) {
    throw new ValidationError(
      parsedFilters.error.issues.map((issue) => issue.message).join("; "),
    );
  }

  return listRequests(parsedFilters.data);
});
