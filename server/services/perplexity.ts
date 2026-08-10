/**
 * Perplexity AI Service
 *
 * Uses Perplexity's API to get real-time NBA player news and summaries.
 */

import { instrumentedFetch } from "../observability/fetch";

interface PerplexityResponse {
  success: boolean;
  content?: string;
  citations?: string[];
  error?: string;
}

class PerplexityService {
  private baseUrl = "https://api.perplexity.ai/chat/completions";
  private backoffUntil = 0;
  private backoffReason: string | null = null;

  constructor() {
    if (this.getApiKey()) {
      console.log("[Perplexity] Service initialized successfully");
    } else {
      console.log("[Perplexity] Not configured at startup - will check API key on each request");
    }
  }

  private getApiKey(): string | null {
    return process.env.PERPLEXITY_API_KEY || null;
  }

  private getBackoffMs(): number {
    const configured = Number(process.env.PERPLEXITY_QUOTA_BACKOFF_MS);
    return Number.isFinite(configured) && configured >= 60_000 ? configured : 6 * 60 * 60 * 1000;
  }

  private activeBackoffError(): string | null {
    if (this.backoffUntil <= Date.now()) {
      this.backoffUntil = 0;
      this.backoffReason = null;
      return null;
    }
    return `Perplexity temporarily backed off until ${new Date(this.backoffUntil).toISOString()}${
      this.backoffReason ? ` (${this.backoffReason})` : ""
    }.`;
  }

  private recordProviderFailure(status: number, body: string): void {
    const normalized = body.toLowerCase();
    const quotaFailure =
      status === 429 ||
      (status === 401 &&
        (normalized.includes("insufficient_quota") ||
          normalized.includes("exceeded your current quota")));
    if (!quotaFailure) return;

    this.backoffUntil = Date.now() + this.getBackoffMs();
    this.backoffReason = status === 429 ? "rate limit" : "quota exhausted";
    console.warn(
      `[Perplexity] Entering provider backoff until ${new Date(this.backoffUntil).toISOString()} (${this.backoffReason})`,
    );
  }

  private unavailableResponse(): PerplexityResponse | null {
    const backoff = this.activeBackoffError();
    return backoff ? { success: false, error: backoff } : null;
  }

  isReady(): boolean {
    return !!this.getApiKey();
  }

  getStatus(): { configured: boolean; backedOff: boolean; backoffUntil: string | null } {
    const backoff = this.activeBackoffError();
    return {
      configured: this.isReady(),
      backedOff: Boolean(backoff),
      backoffUntil: backoff ? new Date(this.backoffUntil).toISOString() : null,
    };
  }

  async getPlayerSummaries(
    playerNames: string[],
    promptTemplate: string,
  ): Promise<PerplexityResponse> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      return {
        success: false,
        error: "Perplexity service not configured. Please add PERPLEXITY_API_KEY.",
      };
    }

    const unavailable = this.unavailableResponse();
    if (unavailable) return unavailable;

    if (!playerNames || playerNames.length === 0) {
      return {
        success: false,
        error: "No player names provided",
      };
    }

    const playersString = playerNames.join(", ");
    const prompt = promptTemplate.replace("{players}", playersString);

    try {
      const response = await instrumentedFetch(this.baseUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "sonar-pro",
          messages: [
            {
              role: "system",
              content:
                "You are a concise sports reporter. Provide brief, factual summaries of NBA player performance and news. Keep responses short and suitable for Twitter posts.",
            },
            {
              role: "user",
              content: prompt,
            },
          ],
          max_tokens: 300,
          temperature: 0.2,
          search_recency_filter: "week",
          return_images: false,
          return_related_questions: false,
        }),
      });

      if (!response.ok) {
        const errorData = await response.text();
        this.recordProviderFailure(response.status, errorData);
        console.error("[Perplexity] API error:", response.status, errorData);
        return {
          success: false,
          error: `API error: ${response.status} - ${errorData}`,
        };
      }

      const data = await response.json();

      if (!data.choices || data.choices.length === 0) {
        return {
          success: false,
          error: "No response from Perplexity",
        };
      }

      const content = data.choices[0]?.message?.content || "";
      const citations = data.citations || [];

      console.log("[Perplexity] Got summary for players:", playerNames.join(", "));

      return {
        success: true,
        content: content.trim(),
        citations,
      };
    } catch (error: any) {
      console.error("[Perplexity] Request failed:", error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  async draftTweet(prompt: string): Promise<PerplexityResponse> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      return {
        success: false,
        error: "Perplexity service not configured. Please add PERPLEXITY_API_KEY.",
      };
    }

    const unavailable = this.unavailableResponse();
    if (unavailable) return unavailable;

    try {
      const response = await instrumentedFetch(this.baseUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "sonar-pro",
          messages: [
            {
              role: "system",
              content:
                "You are a social media manager for Sportfolio, a fantasy sports stock market platform. Your job is to draft engaging tweets about NBA player performance and market activity. Keep tweets concise, use relevant stats, and make them shareable.",
            },
            {
              role: "user",
              content: prompt,
            },
          ],
          max_tokens: 400,
          temperature: 0.7,
          search_recency_filter: "day",
          return_images: false,
          return_related_questions: false,
        }),
      });

      if (!response.ok) {
        const errorData = await response.text();
        this.recordProviderFailure(response.status, errorData);
        console.error("[Perplexity] Draft tweet API error:", response.status, errorData);
        return {
          success: false,
          error: `API error: ${response.status} - ${errorData}`,
        };
      }

      const data = await response.json();

      if (!data.choices || data.choices.length === 0) {
        return {
          success: false,
          error: "No response from Perplexity",
        };
      }

      const content = data.choices[0]?.message?.content || "";
      console.log("[Perplexity] Drafted tweet successfully");

      return {
        success: true,
        content: content.trim(),
      };
    } catch (error: any) {
      console.error("[Perplexity] Draft tweet request failed:", error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  async fetchBreakingNews(prompt: string): Promise<PerplexityResponse> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      return {
        success: false,
        error: "Perplexity service not configured. Please add PERPLEXITY_API_KEY.",
      };
    }

    const unavailable = this.unavailableResponse();
    if (unavailable) {
      console.log(`[Perplexity] ${unavailable.error}`);
      return unavailable;
    }

    try {
      console.log("[Perplexity] Fetching breaking sports news...");

      const response = await instrumentedFetch(this.baseUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "sonar-pro",
          messages: [
            {
              role: "system",
              content:
                "You are a breaking news sports reporter for NBA, NFL, and MLB. Provide factual, concise news updates about player injuries, trades, signings, coaching hires, and major performances. Format your response as: [Headline] - [Brief 1-2 sentence summary].",
            },
            {
              role: "user",
              content: prompt,
            },
          ],
          max_tokens: 400,
          temperature: 0.1,
          search_recency_filter: "day",
          return_images: false,
          return_related_questions: false,
        }),
      });

      if (!response.ok) {
        const errorData = await response.text();
        this.recordProviderFailure(response.status, errorData);
        console.error("[Perplexity] Breaking news API error:", response.status, errorData);
        return {
          success: false,
          error: `API error: ${response.status} - ${errorData}`,
        };
      }

      const data = await response.json();

      if (!data.choices || data.choices.length === 0) {
        return {
          success: false,
          error: "No response from Perplexity",
        };
      }

      const content = data.choices[0]?.message?.content || "";
      const citations = data.citations || [];
      console.log("[Perplexity] Fetched breaking news successfully");

      return {
        success: true,
        content: content.trim(),
        citations,
      };
    } catch (error: any) {
      console.error("[Perplexity] Breaking news request failed:", error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  async testConnection(): Promise<{ valid: boolean; error?: string }> {
    if (!this.isReady()) {
      return {
        valid: false,
        error: "Perplexity service not configured",
      };
    }

    try {
      const result = await this.getPlayerSummaries(
        ["LeBron James"],
        "In one sentence, what was LeBron James' most recent game performance?",
      );

      return {
        valid: result.success,
        error: result.error,
      };
    } catch (error: any) {
      return {
        valid: false,
        error: error.message,
      };
    }
  }
}

export const perplexityService = new PerplexityService();
