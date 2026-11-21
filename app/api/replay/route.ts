import { z } from "zod";
import { generateSummary } from "@/lib/gemini";
import { dashboard, errorResponse, getStore, sameOrigin } from "@/lib/server";
export const runtime = "nodejs";
const schema = z
  .object({ runId: z.uuid(), scenario: z.enum(["isolated", "burst"]) })
  .strict();
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const { runId, scenario } = schema.parse(await request.json());
    const store = getStore();
    const replay = store.replay(runId, scenario);
    if (replay.inserted > 0) {
      for (const id of replay.incidentIds) {
        const incident = store.incident(id)!;
        const summary = await generateSummary(incident, {
          apiKey: process.env.GEMINI_API_KEY,
          model: process.env.GEMINI_MODEL,
        });
        store.saveSummary(id, summary);
      }
    }
    return Response.json({ replay, ...dashboard() });
  } catch (error) {
    return errorResponse(error);
  }
}
