import { apiHandler } from "@/lib/api-handler";
import { runAgent } from "@/agent/agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  return apiHandler(() => runAgent(id, { mode: "replan" }))(_request);
}
