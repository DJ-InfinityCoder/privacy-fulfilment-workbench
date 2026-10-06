import { apiHandler } from "@/lib/api-handler";
import { getLatestInventory } from "@/services/inventory-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  return apiHandler(() => getLatestInventory(id))(_request);
}
