import { apiHandler } from "@/lib/api-handler";
import { getMockActor } from "@/lib/mock-auth";
import { finalizeRequest } from "@/services/fulfilment-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const result = await finalizeRequest(id, await getMockActor(id));
    if (!result.finalized) {
      return Response.json(
        {
          ok: false,
          error: {
            code: "FINALIZATION_PRECONDITIONS_UNMET",
            message: "The request cannot be finalized yet.",
            details: { unmetPreconditions: result.unmetPreconditions },
          },
        },
        { status: 409 },
      );
    }
    return Response.json({ ok: true, data: result });
  } catch (error: unknown) {
    return apiHandler(async () => {
      throw error;
    })(request);
  }
}
