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

type HostSnapshot = {
  toolInput?: unknown;
  toolOutput?: unknown;
  toolResponseMetadata?: unknown;
  widgetState?: unknown;
  locale?: string;
  theme?: string;
  displayMode?: string;
  maxHeight?: number;
  safeArea?: HostSafeArea;
  view?: string;
  userAgent?: string;
};

const pendingRpc = new Map<number, PendingRpc>();
const bridgeSnapshot: HostSnapshot = {};
let rpcId = 1;
let initializePromise: Promise<void> | null = null;

function hostWindow(): Window & { openai?: OpenAIHostApi } {
  return window as Window & { openai?: OpenAIHostApi };
}

export function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function assignIfPresent<K extends keyof HostSnapshot>(
  target: HostSnapshot,
  key: K,
  source: JsonRecord,
): void {
  if (Object.prototype.hasOwnProperty.call(source, key)) {
    target[key] = source[key] as HostSnapshot[K];
  }
}

function applyGlobals(value: unknown): void {
  const params = asRecord(value);
  const globals = asRecord(params.globals);
  const source = Object.keys(globals).length ? globals : params;
  for (const key of [
    "toolInput",
    "toolOutput",
    "toolResponseMetadata",
    "widgetState",
    "locale",
    "theme",
    "displayMode",
    "maxHeight",
    "safeArea",
    "view",
    "userAgent",
  ] as const) {
    assignIfPresent(bridgeSnapshot, key, source);
  }
}

function applyBridgeMessage(message: JsonRecord): void {
  const method = typeof message.method === "string" ? message.method : "";
  const params = asRecord(message.params);
  if (method === "ui/notifications/tool-input") {
    bridgeSnapshot.toolInput = params;
    return;
  }
  if (method === "ui/notifications/tool-result") {
    bridgeSnapshot.toolOutput = params;
    const metadata = params._meta ?? params.meta;
    if (metadata !== undefined) bridgeSnapshot.toolResponseMetadata = metadata;
    return;
  }
  if (method === "openai:set_globals") {
    applyGlobals(params);
  }
}

function bridgeOrHost<T>(bridgeValue: T | undefined, hostValue: T | undefined): T | undefined {
  return bridgeValue !== undefined ? bridgeValue : hostValue;
}

export function getOpenAIHost(): OpenAIHostApi | undefined {
  return hostWindow().openai;
}

export function getHostSnapshot(): HostSnapshot {
  const host = getOpenAIHost();
  return {
    toolInput: bridgeOrHost(bridgeSnapshot.toolInput, host?.toolInput),
    toolOutput: bridgeOrHost(bridgeSnapshot.toolOutput, host?.toolOutput),
    toolResponseMetadata: bridgeOrHost(
      bridgeSnapshot.toolResponseMetadata,
      host?.toolResponseMetadata,
    ),
    widgetState: bridgeOrHost(bridgeSnapshot.widgetState, host?.widgetState),
    locale: bridgeOrHost(bridgeSnapshot.locale, host?.locale),
    theme: bridgeOrHost(bridgeSnapshot.theme, host?.theme),
    displayMode: bridgeOrHost(bridgeSnapshot.displayMode, host?.displayMode),
    maxHeight: bridgeOrHost(bridgeSnapshot.maxHeight, host?.maxHeight),
    safeArea: bridgeOrHost(bridgeSnapshot.safeArea, host?.safeArea),
    view: bridgeOrHost(bridgeSnapshot.view, host?.view),
    userAgent: bridgeOrHost(bridgeSnapshot.userAgent, host?.userAgent),
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

export function initializeMcpApp(): Promise<void> {
  if (initializePromise) return initializePromise;
  initializePromise = (async () => {
    try {
      await parentCall("ui/initialize", {
        protocolVersion: "2025-06-18",
        appInfo: { name: "sportfolio-plugin-ui", version: "2.1.0" },
        capabilities: {},
      });
    } catch {
      // ChatGPT's window.openai compatibility surface may be available without an
      // explicit MCP Apps initialization round trip. Initialization failure is not fatal.
    }
  })();
  return initializePromise;
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
  bridgeSnapshot.widgetState = state;
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
    const message = { method: "openai:set_globals", params: detail };
    applyBridgeMessage(message);
    handler(message);
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
    applyBridgeMessage(message);
    handler(message);
  };

  window.addEventListener("openai:set_globals", onGlobals);
  window.addEventListener("message", onMessage);
  return () => {
    window.removeEventListener("openai:set_globals", onGlobals);
    window.removeEventListener("message", onMessage);
  };
}
