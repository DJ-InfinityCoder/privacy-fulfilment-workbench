import { apiHandler } from "@/lib/api-handler";
import { getMockActor } from "@/lib/mock-auth";
import { retryAction } from "@/services/action-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  return apiHandler(async () =>
    retryAction(id, await getMockActor()),
  )(request);
}
