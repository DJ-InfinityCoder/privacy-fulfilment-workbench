import { getAIHealth } from "@/ai/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(
    { ok: true, data: getAIHealth() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
