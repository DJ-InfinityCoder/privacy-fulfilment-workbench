import { apiHandler } from "@/lib/api-handler";
import { runSearch } from "@/services/search-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  return apiHandler(() =>
    runSearch(id, {
      actorId: request.headers.get("x-actor-id")?.trim() || "privacy-ops",
      actorType: "human",
    }),
  )(request);
}
