import { cookies } from "next/headers";
import { appendAudit } from "@/lib/audit";
import { ForbiddenError } from "@/lib/errors";
import type { AuditEventType } from "@/models/model-types";
import {
  demoUsers,
  mockRoles,
  mockRoleCookieName,
  parseMockRole,
  type DemoUser,
  type MockRole,
} from "@/lib/mock-auth-types";

export * from "@/lib/mock-auth-types";

export type MockActor = {
  actorId: string;
  actorType: "human";
  role: MockRole;
};

export async function getMockRole(request?: Request): Promise<MockRole> {
  const headerRole = request?.headers.get("x-actor-role");
  if (headerRole && (mockRoles as readonly string[]).includes(headerRole)) {
    return headerRole as MockRole;
  }
  try {
    const cookieStore = await cookies();
    return parseMockRole(cookieStore.get(mockRoleCookieName)?.value);
  } catch {
    return "analyst";
  }
}

export async function getMockActor(
  requestIdOrOptions?: string | { requestId?: string; request?: Request },
): Promise<MockActor> {
  const request =
    typeof requestIdOrOptions === "object" ? requestIdOrOptions.request : undefined;
  const role = await getMockRole(request);
  const user = demoUsers[role];
  const headerActorId = request?.headers.get("x-actor-id");

  return {
    actorId: headerActorId || user.id,
    actorType: "human",
    role: user.role,
  };
}

export async function requireRole(
  allowed: MockRole | readonly MockRole[],
  auditContext?: {
    requestId?: string;
    eventType?: AuditEventType;
    toolName?: string;
    input?: unknown;
    request?: Request;
  },
): Promise<MockActor> {
  const actor = await getMockActor(auditContext?.request ? { request: auditContext.request } : undefined);
  const allowedList = Array.isArray(allowed) ? allowed : [allowed];

  if (!allowedList.includes(actor.role)) {
    await appendAudit({
      requestId: auditContext?.requestId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      eventType: auditContext?.eventType ?? "TOOL_DENIED",
      toolName: auditContext?.toolName,
      input: auditContext?.input,
      status: "denied",
      error: {
        code: "FORBIDDEN",
        message: `Role '${actor.role}' is not authorized. Required: ${allowedList.join(", ")}`,
      },
    });

    throw new ForbiddenError(
      `Role '${actor.role}' is not authorized to perform this operation. Required role: ${allowedList.join(", ")}.`,
    );
  }

  return actor;
}
