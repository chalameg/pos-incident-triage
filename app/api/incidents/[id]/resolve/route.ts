import { z } from "zod";
import { validIssueUrl } from "@/lib/providers";
import {
  dashboard,
  errorResponse,
  getStore,
  sameOrigin,
  settings,
} from "@/lib/server";
export const runtime = "nodejs";
const schema = z
  .object({
    provider: z.enum(["github", "slack"]),
    resolution: z.enum(["delivered", "absent"]),
    checkedDestination: z.literal(true),
    issueUrl: z.string().max(300).optional(),
  })
  .strict();
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    sameOrigin(request);
    const input = schema.parse(await request.json());
    const { id } = await context.params;
    const store = getStore();
    const config = settings();
    if (!store.incident(id))
      return Response.json({ error: "Incident not found." }, { status: 404 });
    const action = store
      .actions(id, config.mode)
      .find((a) => a.provider === input.provider)!;
    let url: string | null = null;
    if (input.resolution === "delivered" && input.provider === "github") {
      if (
        !input.issueUrl ||
        !action.target ||
        !validIssueUrl(input.issueUrl, action.target)
      )
        throw new Error(
          "Enter the existing GitHub issue URL from the original demo repository.",
        );
      url = input.issueUrl;
    }
    store.resolve(id, config.mode, input.provider, input.resolution, url);
    return Response.json(dashboard());
  } catch (error) {
    return errorResponse(error, 409);
  }
}
