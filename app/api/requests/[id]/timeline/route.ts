import { apiHandler } from "@/lib/api-handler";
import { getRequestById } from "@/services/request-service";
import { listAudit } from "@/services/audit-service";
import { ValidationError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  return apiHandler(async (request) => {
    await getRequestById(id);
    const params = new URL(request.url).searchParams;
    const page = Number(params.get("page") ?? "1");
    if (!Number.isInteger(page) || page < 1) {
      throw new ValidationError("Timeline page must be a positive integer.");
    }

    return listAudit({
      requestId: id,
      page,
      pageSize: 100,
    });
  })(request);
}
