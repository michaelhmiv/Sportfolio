export type JsonRecord = Record<string, unknown>;
export type DisplayMode = "inline" | "fullscreen" | "pip";

export type HostSafeArea = {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
};

export type OpenAIHostApi = {
  toolInput?: unknown;
  toolOutput?: unknown;
  toolResponseMetadata?: unknown;
  widgetState?: unknown;
  locale?: string;
  theme?: "light" | "dark" | string;
  displayMode?: DisplayMode | string;
  maxHeight?: number;
  safeArea?: HostSafeArea;
  view?: string;
  userAgent?: string;
  callTool?: (name: string, args: JsonRecord) => Promise<unknown>;
  requestDisplayMode?: (input: { mode: DisplayMode }) => Promise<unknown>;
  setWidgetState?: (state: unknown) => void;
  sendFollowUpMessage?: (input: { prompt: string; scrollToBottom?: boolean }) => Promise<unknown>;
  requestModal?: (input: { params?: JsonRecord; template?: string }) => Promise<unknown>;
  requestClose?: () => Promise<unknown>;
  notifyIntrinsicHeight?: () => void;
  openExternal?: (input: { href: string }) => Promise<unknown>;
  setOpenInAppUrl?: (input: { href: string }) => void;
};

type PendingRpc = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timer: number;
};

type HostMessageHandler = (message: JsonRecord) => void;

const pendingRpc = new Map<number, PendingRpc>();
let rpcId = 1;

function hostWindow(): Window & { openai?: OpenAIHostApi } {
  return window as Window & { openai?: OpenAIHostApi };
}

export function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

export function getOpenAIHost(): OpenAIHostApi | undefined {
  return hostWindow().openai;
}

export function getHostSnapshot() {
  const host = getOpenAIHost();
  return {
    toolInput: host?.toolInput,
    toolOutput: host?.toolOutput,
    toolResponseMetadata: host?.toolResponseMetadata,
    widgetState: host?.widgetState,
    locale: host?.locale,
    theme: host?.theme,
    displayMode: host?.displayMode,
    maxHeight: host?.maxHeight,
    safeArea: host?.safeArea,
    view: host?.view,
    userAgent: host?.userAgent,
  };
}

export function parentCall(method: string, params: JsonRecord): Promise<unknown> {
  const id = rpcId++;
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pendingRpc.delete(id);
      reject(new Error(`Host request timed out: ${method}`));
    }, 20_000);
    pendingRpc.set(id, { resolve, reject, timer });
    window.parent.postMessage({ jsonrpc: "2.0", id, method, params }, "*");
  });
}

export async function initializeMcpApp(): Promise<void> {
  try {
    await parentCall("ui/initialize", {
      protocolVersion: "2025-06-18",
      appInfo: { name: "sportfolio-plugin-ui", version: "2.0.0" },
      capabilities: {},
    });
  } catch {
    // ChatGPT's window.openai compatibility surface may be available without an
    // explicit MCP Apps initialization round trip. Initialization failure is not fatal.
  }
}

export async function callTool(name: string, args: JsonRecord): Promise<unknown> {
  const direct = getOpenAIHost()?.callTool;
  if (direct) return direct(name, args);
  return parentCall("tools/call", { name, arguments: args });
}

export async function requestDisplayMode(mode: DisplayMode): Promise<unknown> {
  const direct = getOpenAIHost()?.requestDisplayMode;
  if (direct) return direct({ mode });
  return parentCall("ui/request-display-mode", { mode });
}

export function persistWidgetState(state: unknown): void {
  getOpenAIHost()?.setWidgetState?.(state);
}

export async function updateModelContext(
  structuredContent: JsonRecord,
  contentText?: string,
): Promise<void> {
  const params: JsonRecord = { structuredContent };
  if (contentText) params.content = [{ type: "text", text: contentText }];
  try {
    await parentCall("ui/update-model-context", params);
  } catch {
    // Model-context updates are progressive enhancement. Tool calls remain authoritative.
  }
}

export async function sendFollowUpMessage(prompt: string): Promise<unknown> {
  const direct = getOpenAIHost()?.sendFollowUpMessage;
  if (direct) return direct({ prompt, scrollToBottom: true });
  return parentCall("ui/message", {
    role: "user",
    content: [{ type: "text", text: prompt }],
  });
}

export async function requestModal(params: JsonRecord, template?: string): Promise<unknown> {
  const direct = getOpenAIHost()?.requestModal;
  if (!direct) throw new Error("Modal presentation is not supported by this host.");
  return direct({ params, ...(template ? { template } : {}) });
}

export async function requestClose(): Promise<void> {
  await getOpenAIHost()?.requestClose?.();
}

export function notifyIntrinsicHeight(): void {
  getOpenAIHost()?.notifyIntrinsicHeight?.();
}

export async function openExternal(href: string): Promise<unknown> {
  const direct = getOpenAIHost()?.openExternal;
  if (direct) return direct({ href });
  return parentCall("ui/open-link", { url: href });
}

export function setOpenInAppUrl(href: string): void {
  getOpenAIHost()?.setOpenInAppUrl?.({ href });
}

export function subscribeHostMessages(handler: HostMessageHandler): () => void {
  const onGlobals = (event: Event) => {
    const detail = asRecord((event as CustomEvent<unknown>).detail);
    handler({ method: "openai:set_globals", params: detail });
  };

  const onMessage = (event: MessageEvent) => {
    if (event.source !== window.parent) return;
    const message = asRecord(event.data);
    const rawId = message.id;
    const id = typeof rawId === "number" ? rawId : Number(rawId);
    if (Number.isFinite(id) && pendingRpc.has(id) && ("result" in message || "error" in message)) {
      const pending = pendingRpc.get(id);
      if (!pending) return;
      window.clearTimeout(pending.timer);
      pendingRpc.delete(id);
      if (message.error) {
        pending.reject(new Error(String(asRecord(message.error).message || "Host error")));
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    handler(message);
  };

  window.addEventListener("openai:set_globals", onGlobals);
  window.addEventListener("message", onMessage);
  return () => {
    window.removeEventListener("openai:set_globals", onGlobals);
    window.removeEventListener("message", onMessage);
  };
}
