import {
  dashboard,
  errorResponse,
  getStore,
  rules,
  sameOrigin,
} from "@/lib/server";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const run = getStore().createRun(rules());
    return Response.json({ run, ...dashboard() });
  } catch (error) {
    return errorResponse(error);
  }
}
