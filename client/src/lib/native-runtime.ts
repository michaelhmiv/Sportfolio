import { Capacitor } from "@capacitor/core";

const LOCAL_API_ORIGIN = "https://www.sportfolio.market";

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

export function isNativeRuntime() {
  return Capacitor.isNativePlatform();
}

export function getNativeApiOrigin() {
  const configuredOrigin =
    typeof import.meta.env.VITE_NATIVE_API_ORIGIN === "string"
      ? import.meta.env.VITE_NATIVE_API_ORIGIN.trim()
      : "";

  if (configuredOrigin) {
    return trimTrailingSlash(configuredOrigin);
  }

  return LOCAL_API_ORIGIN;
}

export function resolveApiUrl(path: string) {
  if (!path.startsWith("/")) {
    return path;
  }

  if (!isNativeRuntime()) {
    return path;
  }

  return `${getNativeApiOrigin()}${path}`;
}

export function resolveWebSocketUrl(path = "/ws") {
  if (typeof window === "undefined") {
    return path;
  }

  if (!isNativeRuntime()) {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}${path}`;
  }

  const apiOrigin = new URL(getNativeApiOrigin());
  apiOrigin.protocol = apiOrigin.protocol === "https:" ? "wss:" : "ws:";
  apiOrigin.pathname = path;
  apiOrigin.search = "";
  apiOrigin.hash = "";
  return apiOrigin.toString();
}

export function resolvePublicAppUrl(path: string) {
  const safePath = path.startsWith("/") ? path : `/${path}`;
  return `${getNativeApiOrigin()}${safePath}`;
}
