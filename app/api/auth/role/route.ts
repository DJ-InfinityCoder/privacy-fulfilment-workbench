import { cookies } from "next/headers";
import { z } from "zod";
import { apiHandler } from "@/lib/api-handler";
import { mockRoleCookieName } from "@/lib/mock-auth";
import { ValidationError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const roleSchema = z.object({
  role: z.enum(["analyst", "approver"]),
});

export async function POST(request: Request) {
  return apiHandler(async () => {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ValidationError("Request body must contain valid JSON.");
    }
    const parsed = roleSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError("A valid mock role is required.");
    }
    const cookieStore = await cookies();
    cookieStore.set(mockRoleCookieName, parsed.data.role, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return { role: parsed.data.role };
  })(request);
}
