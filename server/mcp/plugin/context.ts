import type { PluginAuthContext } from "../../auth/plugin-oauth";

export type PluginMcpContext = {
  auth: PluginAuthContext | null;
  requestId: string;
};
