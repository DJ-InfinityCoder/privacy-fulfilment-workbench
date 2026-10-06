import { apiHandler } from "@/lib/api-handler";
import { connectDB } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = apiHandler(async () => {
  await connectDB();
  return { database: "connected" };
});
