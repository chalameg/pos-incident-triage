import { createHash } from "node:crypto";
import { ProviderError, type Providers } from "./escalation";

export interface LiveConfig {
  githubToken: string;
  githubRepository: string;
  slackWebhookUrl: string;
  slackChannelLabel: string;
}
export function validIssueUrl(value: string, repository: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "github.com" &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname.startsWith(`/${repository}/issues/`) &&
      /^[1-9]\d*$/.test(url.pathname.slice(`/${repository}/issues/`.length))
    );
  } catch {
    return false;
  }
}
export function validateLiveConfig(config: LiveConfig) {
  if (
    !config.githubToken ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(config.githubRepository) ||
    !config.slackChannelLabel.trim()
  )
    throw new ProviderError(
      "Configure a GitHub token, dedicated demo repository, and Slack channel label before live approval.",
    );
  let url: URL;
  try {
    url = new URL(config.slackWebhookUrl);
  } catch {
    throw new ProviderError(
      "Configure a valid Slack incoming webhook before live approval.",
    );
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "hooks.slack.com" ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\/services\/[A-Za-z0-9]+\/[A-Za-z0-9]+\/[A-Za-z0-9]+$/.test(url.pathname)
  )
    throw new ProviderError(
      "Slack webhook must use https://hooks.slack.com/services/...",
    );
}
export function providerTargets(config: LiveConfig) {
  return {
    github: config.githubRepository,
    slack: `${config.slackChannelLabel} · ${createHash("sha256").update(config.slackWebhookUrl).digest("hex").slice(0, 16)}`,
  };
}
export function liveProviders(
  config: LiveConfig,
  fetcher: typeof fetch = fetch,
): Providers {
  validateLiveConfig(config);
  const send = async (
    url: string,
    headers: Record<string, string>,
    payload: unknown,
  ) => {
    try {
      return await fetcher(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15_000),
        redirect: "error",
      });
    } catch {
      throw new ProviderError(
        "Request timed out or delivery could not be confirmed. Check the destination before retrying.",
        true,
      );
    }
  };
  const checkStatus = (response: Response, provider: string) => {
    if (!response.ok)
      throw new ProviderError(
        `${provider} returned HTTP ${response.status}.${response.status >= 500 || response.status === 408 ? " Delivery may have occurred; check the destination." : " Check credentials, permissions, destination, or rate limits before retrying."}`,
        response.status >= 500 || response.status === 408,
      );
  };
  return {
    async github(payload) {
      const response = await send(
        `https://api.github.com/repos/${config.githubRepository}/issues`,
        {
          Authorization: `Bearer ${config.githubToken}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2026-03-10",
        },
        payload,
      );
      checkStatus(response, "GitHub");
      if (response.status !== 201)
        throw new ProviderError(
          "GitHub did not confirm issue creation. Check the repository.",
          true,
        );
      try {
        const body = await response.json();
        if (
          typeof body.html_url !== "string" ||
          !validIssueUrl(body.html_url, config.githubRepository)
        )
          throw new Error("Invalid issue URL.");
        return body.html_url as string;
      } catch {
        throw new ProviderError(
          "GitHub may have created the issue, but its URL could not be verified. Check the repository.",
          true,
        );
      }
    },
    async slack(payload) {
      const response = await send(
        config.slackWebhookUrl,
        {},
        { ...payload, unfurl_links: false, unfurl_media: false },
      );
      checkStatus(response, "Slack");
      let body: string;
      try {
        body = await response.text();
      } catch {
        throw new ProviderError(
          "Slack delivery could not be confirmed. Check the channel.",
          true,
        );
      }
      if (response.status !== 200 || body.trim() !== "ok")
        throw new ProviderError(
          "Slack did not confirm delivery. Check the channel.",
          true,
        );
    },
  };
}
