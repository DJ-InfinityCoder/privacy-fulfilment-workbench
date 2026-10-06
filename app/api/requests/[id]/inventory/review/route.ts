import { apiHandler } from "@/lib/api-handler";
import { ValidationError } from "@/lib/errors";
import { reviewInventory } from "@/services/inventory-service";

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

    return reviewInventory(
      id,
      body,
      {
        actorId: request.headers.get("x-actor-id")?.trim() || "privacy-ops",
        actorType: "human",
      },
    );
  })(request);
}
