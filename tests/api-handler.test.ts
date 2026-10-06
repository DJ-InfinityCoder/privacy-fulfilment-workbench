import { describe, expect, it } from "vitest";
import { apiHandler } from "@/lib/api-handler";
import { NotFoundError } from "@/lib/errors";

describe("apiHandler", () => {
  it("returns successful handler data in the standard response shape", async () => {
    const handler = apiHandler(async () => ({ status: "ready" }));
    const response = await handler(new Request("http://localhost/api/test"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      data: { status: "ready" },
    });
  });

  it("preserves the status and message of typed errors", async () => {
    const handler = apiHandler(async () => {
      throw new NotFoundError("Request not found.");
    });
    const response = await handler(new Request("http://localhost/api/test"));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: { code: "NOT_FOUND", message: "Request not found." },
    });
  });
});
