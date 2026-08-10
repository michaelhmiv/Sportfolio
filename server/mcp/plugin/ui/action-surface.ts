import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getGameplayTransaction } from "../../gameplay-transactions";
import { getPluginOAuthConfig } from "../../../auth/plugin-oauth-config";
import { pluginMcpAuthError } from "../../../auth/plugin-auth-challenge";
import type { PluginMcpContext } from "../context";
import { assertNoRestrictedPluginFields, sanitizePluginValue } from "../sanitizer";
import { SPORTFOLIO_WIDGET_HTML } from "./generated-widget";
import { SPORTFOLIO_SHARED_UI_RESOURCE_URI } from "./shared-resource";

type JsonRecord = Record<string, unknown>;

export const SPORTFOLIO_ACTION_UI_RESOURCE_URI = "ui://sportfolio/action-review/v1.html";

const actionReviewInputSchema = {
  transactionId: z.string().uuid(),
};

const actionReviewOutputSchema = {
  view: z.literal("action_review"),
  asOf: z.string().datetime(),
  data: z.unknown(),
  warnings: z.array(z.string().max(500)).max(20),
};

function flagEnabled(name: string, defaultValue = true): boolean {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return defaultValue;
  return !["0", "false", "off", "no"].includes(raw.trim().toLowerCase());
}

function sanitizeActionReview(data: JsonRecord): JsonRecord {
  const payload = sanitizePluginValue({
    view: "action_review",
    asOf: new Date().toISOString(),
    data,
    warnings: [],
  });
  assertNoRestrictedPluginFields(payload);
  return payload as JsonRecord;
}

export function buildActionPluginPresentationCatalog() {
  return [
    {
      name: "render_action_review",
      title: "Review Sportfolio action",
      description:
        "Render the exact pending Sportfolio gameplay transaction identified by a server-issued transactionId with Confirm and Cancel controls. Use this for staged market, scouting, boost, liquidity, stacking, and community-boost actions.",
      view: "action_review" as const,
      access: "oauth" as const,
      featureFlag: "PLUGIN_UI_ACTION_REVIEW_V2_ENABLED",
      resourceUri: SPORTFOLIO_ACTION_UI_RESOURCE_URI,
      fixtureArgs: { transactionId: "00000000-0000-4000-8000-000000000001" },
      readOnly: true as const,
      destructive: false as const,
      openWorld: false as const,
    },
  ];
}

export async function registerActionPluginUiSurface(
  server: McpServer,
  context: PluginMcpContext,
): Promise<void> {
  if (!flagEnabled("PLUGIN_UI_ENABLED") || !flagEnabled("PLUGIN_UI_ACTION_REVIEW_V2_ENABLED")) {
    return;
  }

  const description =
    "Sportfolio staged-action review with the exact server preview, warnings, and explicit Confirm or Cancel controls.";

  server.registerResource(
    "sportfolio-plugin-action-review-ui",
    SPORTFOLIO_ACTION_UI_RESOURCE_URI,
    {
      mimeType: "text/html;profile=mcp-app",
      description,
    },
    async () =>
      ({
        contents: [
          {
            uri: SPORTFOLIO_ACTION_UI_RESOURCE_URI,
            mimeType: "text/html;profile=mcp-app",
            text: SPORTFOLIO_WIDGET_HTML,
            _meta: {
              ui: {
                domain: "https://www.sportfolio.market",
                prefersBorder: true,
                csp: {
                  connectDomains: [],
                  resourceDomains: ["https://www.sportfolio.market"],
                },
              },
              "openai/widgetDescription": description,
              "openai/widgetPrefersBorder": true,
            },
          },
        ],
      }) as any,
  );

  const oauthSecurity = [{ type: "oauth2" as const, scopes: ["openid"] }];
  server.registerTool(
    "render_action_review",
    {
      title: "Review Sportfolio action",
      description:
        "Render an exact staged Sportfolio gameplay transaction using its server-issued transactionId. The presentation is read-only; confirmation and cancellation remain separate explicit actions.",
      inputSchema: actionReviewInputSchema,
      outputSchema: actionReviewOutputSchema,
      securitySchemes: oauthSecurity,
      annotations: {
        title: "Review Sportfolio action",
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: {
        securitySchemes: oauthSecurity,
        source: "plugin_ui:action_review",
        access: "oauth",
        ui: { resourceUri: SPORTFOLIO_SHARED_UI_RESOURCE_URI },
        "openai/outputTemplate": SPORTFOLIO_SHARED_UI_RESOURCE_URI,
        "openai/toolInvocation/invoking": "Loading staged Sportfolio action…",
        "openai/toolInvocation/invoked": "Sportfolio action ready for review.",
        fixtureArgs: { transactionId: "00000000-0000-4000-8000-000000000001" },
      },
    } as any,
    async (args: any) => {
      if (!context.auth?.userId) {
        return pluginMcpAuthError(getPluginOAuthConfig(), {
          error: "invalid_token",
          description: "Connect your Sportfolio account to review this staged action.",
        }) as any;
      }

      try {
        const transactionId = String(args?.transactionId || "");
        const transaction = await getGameplayTransaction(context.auth.userId, transactionId);
        const structuredContent = sanitizeActionReview({
          transactionId,
          summary: transaction.summary,
          warnings: transaction.warnings,
          confirmationRequired: transaction.status === "pending_confirmation",
          status: transaction.status,
          transaction,
        });
        return {
          content: [
            {
              type: "text" as const,
              text:
                transaction.status === "pending_confirmation"
                  ? "The staged Sportfolio action is ready for explicit confirmation or cancellation."
                  : `The Sportfolio action is ${transaction.status}.`,
            },
          ],
          structuredContent,
        } as any;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Sportfolio could not load this action.";
        return {
          isError: true,
          content: [{ type: "text" as const, text: message }],
          structuredContent: sanitizeActionReview({
            code: "plugin_ui_action_review_failed",
            message,
          }),
        } as any;
      }
    },
  );
}
