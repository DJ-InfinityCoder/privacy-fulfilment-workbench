import { apiHandler } from "@/lib/api-handler";
import { getFulfilmentRecord } from "@/services/fulfilment-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const format = new URL(request.url).searchParams.get("format") ?? "json";
  if (format !== "json" && format !== "html") {
    return Response.json(
      {
        ok: false,
        error: { code: "VALIDATION_ERROR", message: "Format must be json or html." },
      },
      { status: 400 },
    );
  }

  if (format === "html") {
    try {
      const { record, html } = await getFulfilmentRecord(id);
      return new Response(html, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Disposition": `inline; filename="${encodeURIComponent(record.recordId)}.html"`,
          "Cache-Control": "no-store",
        },
      });
    } catch (error: unknown) {
      return apiHandler(async () => {
        throw error;
      })(request);
    }
  }

  return apiHandler(async () => {
    const { record, hashValid } = await getFulfilmentRecord(id);
    return { record, hashValid };
  })(request);
}
