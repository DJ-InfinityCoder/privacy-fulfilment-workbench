import { apiHandler } from "@/lib/api-handler";
import { generateExport } from "@/services/export-service";

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
        error: {
          code: "VALIDATION_ERROR",
          message: "Export format must be json or html.",
        },
      },
      { status: 400 },
    );
  }

  try {
    const generated = await generateExport(id, {
      actorId: request.headers.get("x-actor-id")?.trim() || "privacy-ops",
      actorType: "human",
    });
    const filename = `${encodeURIComponent(id)}-export.${format}`;
    if (format === "html") {
      return new Response(generated.html, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "no-store",
        },
      });
    }
    return new Response(JSON.stringify(generated.json, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error: unknown) {
    return apiHandler(async () => {
      throw error;
    })(request);
  }
}
