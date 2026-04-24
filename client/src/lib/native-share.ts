/**
 * Native share utility using @capacitor/share.
 * Falls back to the Web Share API on browsers that support it,
 * and does nothing silently if neither is available.
 */

import { Capacitor } from "@capacitor/core";
import { Share } from "@capacitor/share";

interface ShareOptions {
  title: string;
  text: string;
  url: string;
  dialogTitle?: string;
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

    // Last resort: copy URL to clipboard
    await navigator.clipboard.writeText(options.url);
  } catch {
    // Share cancelled or unavailable — ignore
  }
}

/** Share a player's Sportfolio page */
export async function sharePlayer(
  playerId: string,
  playerName: string,
  price?: number,
): Promise<void> {
  const url = `https://www.sportfolio.market/player/${playerId}`;
  const priceText = price != null ? ` @ $${price.toFixed(2)}` : "";
  await nativeShare({
    title: `${playerName} on Sportfolio`,
    text: `Check out ${playerName}${priceText} on Sportfolio — the fantasy sports stock market.`,
    url,
    dialogTitle: `Share ${playerName}`,
  });
}
