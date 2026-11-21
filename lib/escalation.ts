import { payloads, type Incident, type Mode, type Provider } from "./domain";
import { Store } from "./store";

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly uncertain = false,
  ) {
    super(message);
  }
}
export interface Providers {
  github(
    payload: ReturnType<typeof payloads>["github"],
    incident: Incident,
  ): Promise<string>;
  slack(payload: ReturnType<typeof payloads>["slack"]): Promise<void>;
}
export const previewProviders: Providers = {
  async github(_payload, incident) {
    return `https://example.invalid/preview/issues/${incident.id}`;
  },
  async slack() {},
};
export async function approve(
  store: Store,
  id: string,
  mode: Mode,
  providers: Providers,
  destinations: { github: string; slack: string },
) {
  store.recoverStale();
  const incident = store.incident(id);
  if (!incident) throw new Error("Incident not found.");
  for (const provider of ["github", "slack"] as Provider[]) {
    const issueUrl = store
      .actions(id, mode)
      .find((a) => a.provider === "github")?.url;
    if (provider === "slack" && !issueUrl)
      throw new Error("A saved GitHub issue is required before Slack.");
    const payload = payloads(incident, issueUrl ?? undefined)[provider];
    const token = store.claim(
      id,
      mode,
      provider,
      destinations[provider],
      payload,
    );
    if (!token) continue;
    try {
      const url =
        provider === "github"
          ? await providers.github(
              payload as ReturnType<typeof payloads>["github"],
              incident,
            )
          : (await providers.slack(
              payload as ReturnType<typeof payloads>["slack"],
            ),
            null);
      store.finish(token, "succeeded", url, null);
    } catch (error) {
      // Unclassified failures may have happened after delivery. Never auto-retry them.
      const uncertain = !(error instanceof ProviderError) || error.uncertain;
      store.finish(
        token,
        uncertain ? "unknown" : "failed",
        null,
        error instanceof ProviderError
          ? error.message
          : "Provider response was not confirmed. Check the destination.",
      );
      break;
    }
  }
  return store.view(id, mode)!;
}
