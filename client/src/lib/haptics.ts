/**
 * Haptics utility – thin wrapper around @capacitor/haptics.
 *
 * All calls are no-ops on web or if haptics are unavailable, so callers
 * don't need to guard behind platform checks.
 */

import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";

function isHapticsAvailable(): boolean {
  return Capacitor.isNativePlatform();
}

/** Light tap — nav transitions, drawer opens, small confirmations. */
export async function hapticLight(): Promise<void> {
  if (!isHapticsAvailable()) return;
  await Haptics.impact({ style: ImpactStyle.Light }).catch(() => undefined);
}

/** Medium tap — standard interactive feedback. */
export async function hapticMedium(): Promise<void> {
  if (!isHapticsAvailable()) return;
  await Haptics.impact({ style: ImpactStyle.Medium }).catch(() => undefined);
}

/** Heavy tap — boost assigned, high-stakes confirmation. */
export async function hapticHeavy(): Promise<void> {
  if (!isHapticsAvailable()) return;
  await Haptics.impact({ style: ImpactStyle.Heavy }).catch(() => undefined);
}

/** Success notification — trade completed, reward claimed. */
export async function hapticSuccess(): Promise<void> {
  if (!isHapticsAvailable()) return;
  await Haptics.notification({ type: NotificationType.Success }).catch(() => undefined);
}

/** Error notification — trade failed, insufficient balance. */
export async function hapticError(): Promise<void> {
  if (!isHapticsAvailable()) return;
  await Haptics.notification({ type: NotificationType.Error }).catch(() => undefined);
}

/** Warning notification — boost slot locked, action blocked. */
export async function hapticWarning(): Promise<void> {
  if (!isHapticsAvailable()) return;
  await Haptics.notification({ type: NotificationType.Warning }).catch(() => undefined);
}

/** Pull-to-refresh trigger snap — fired at the point the refresh activates. */
export async function hapticRefreshTrigger(): Promise<void> {
  await hapticMedium();
}
