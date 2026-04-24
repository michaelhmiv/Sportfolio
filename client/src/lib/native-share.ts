/**
 * Native share utility using @capacitor/share.
 * Falls back to the Web Share API on browsers that support it,
 * and copies the URL to clipboard as a last resort — notifying the caller
 * so they can show a toast or confirmation to the user.
 */

import { Capacitor } from "@capacitor/core";
import { Share } from "@capacitor/share";

interface ShareOptions {
  title: string;
  text: string;
  url: string;
  dialogTitle?: string;
  /** Called when the URL was copied to clipboard (no native share sheet was shown). */
  onClipboardFallback?: () => void;
}

export async function nativeShare(options: ShareOptions): Promise<void> {
  try {
    if (Capacitor.isNativePlatform()) {
      await Share.share({
        title: options.title,
        text: options.text,
        url: options.url,
        dialogTitle: options.dialogTitle ?? options.title,
      });
      return;
    }

    // Web Share API fallback
    if (navigator.share) {
      await navigator.share({
        title: options.title,
        text: options.text,
        url: options.url,
      });
      return;
    }

    // Last resort: copy URL to clipboard and inform caller so they can show feedback.
    await navigator.clipboard.writeText(options.url);
    options.onClipboardFallback?.();
  } catch {
    // Share cancelled or unavailable — ignore
  }
}

/** Share a player's Sportfolio page */
export async function sharePlayer(
  playerId: string,
  playerName: string,
  price?: number,
  onClipboardFallback?: () => void,
): Promise<void> {
  const url = `https://www.sportfolio.market/player/${playerId}`;
  const priceText = price != null ? ` @ $${price.toFixed(2)}` : "";
  await nativeShare({
    title: `${playerName} on Sportfolio`,
    text: `Check out ${playerName}${priceText} on Sportfolio — the fantasy sports stock market.`,
    url,
    dialogTitle: `Share ${playerName}`,
    onClipboardFallback,
  });
}
