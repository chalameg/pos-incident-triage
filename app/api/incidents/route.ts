import { dashboard, errorResponse } from "@/lib/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    return Response.json(dashboard());
  } catch (error) {
    return errorResponse(error, 500);
  }
}
