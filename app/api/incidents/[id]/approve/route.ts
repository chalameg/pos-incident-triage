import { z } from "zod";
import { approve, previewProviders } from "@/lib/escalation";
import { liveProviders, providerTargets } from "@/lib/providers";
import {
  dashboard,
  errorResponse,
  getStore,
  liveConfig,
  reviewToken,
  sameOrigin,
  settings,
} from "@/lib/server";
export const runtime = "nodejs";
const approvalSchema = z
  .object({
    approved: z.literal(true),
    reviewToken: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    sameOrigin(request);
    const approval = approvalSchema.parse(await request.json());
    const { id } = await context.params;
    const config = settings();
    const store = getStore();
    const incident = store.incident(id);
    if (!incident)
      return Response.json({ error: "Incident not found." }, { status: 404 });
    if (approval.reviewToken !== reviewToken(incident))
      throw new Error(
        "The draft or destination changed. Review the refreshed payloads before approving.",
      );
    const live = liveConfig();
    const providers =
      config.mode === "live" ? liveProviders(live) : previewProviders;
    const targets =
      config.mode === "live" ? providerTargets(live) : config.destinations;
    await approve(store, id, config.mode, providers, targets);
    return Response.json(dashboard());
  } catch (error) {
    return errorResponse(error, 409);
  }
}
