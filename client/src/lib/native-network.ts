/**
 * Native network status using @capacitor/network on Android/iOS.
 * Falls back to the window online/offline events on the web.
 */

import { Capacitor } from "@capacitor/core";
import { Network } from "@capacitor/network";

type NetworkListener = (isOnline: boolean) => void;

const listeners = new Set<NetworkListener>();
let currentStatus = true; // optimistic default

function notifyListeners(isOnline: boolean): void {
  currentStatus = isOnline;
  listeners.forEach((fn) => fn(isOnline));
}

async function initNative(): Promise<void> {
  const status = await Network.getStatus().catch(() => null);
  if (status) {
    notifyListeners(status.connected);
  }

  await Network.addListener("networkStatusChange", (status) => {
    notifyListeners(status.connected);
  }).catch(() => undefined);
}

function initWeb(): void {
  notifyListeners(navigator.onLine);
  window.addEventListener("online", () => notifyListeners(true));
  window.addEventListener("offline", () => notifyListeners(false));
}

let initialized = false;

export function initNetworkMonitor(): void {
  if (initialized) return;
  initialized = true;

  if (Capacitor.isNativePlatform()) {
    void initNative();
  } else {
    initWeb();
  }
}

export function addNetworkListener(fn: NetworkListener): () => void {
  listeners.add(fn);
  // immediately deliver current status
  fn(currentStatus);
  return () => listeners.delete(fn);
}

export function getIsOnline(): boolean {
  return currentStatus;
}
