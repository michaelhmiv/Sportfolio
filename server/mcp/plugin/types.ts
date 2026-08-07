export type PluginToolAccess = "public" | "oauth";

export type PluginDataClassification =
  | "public"
  | "user_gameplay"
  | "user_portfolio"
  | "user_preferences";

export type PluginToolPolicy = {
  name: string;
  access: PluginToolAccess;
  dataClassification: PluginDataClassification;
  readOnly: true;
  openWorld: false;
  destructive: false;
};

export type PluginExcludedCapability = {
  name: string;
  reason:
    | "credential_or_authentication_secret"
    | "account_security_management"
    | "user_profile_mutation"
    | "gameplay_mutation"
    | "billing_or_purchase"
    | "admin_or_internal"
    | "dynamic_or_unversioned_surface"
    | "open_world_research";
};

export type PluginMarketplaceContract = {
  version: "v1";
  endpoint: "/mcp/plugin";
  tools: readonly PluginToolPolicy[];
  excluded: readonly PluginExcludedCapability[];
};
