import { registerPlugin } from "@capacitor/core";
import { isNativeAndroid } from "./native-platform";

interface AndroidNotificationSettingsPlugin {
  openNotificationSettings(): Promise<{ opened: boolean }>;
}

const AndroidNotificationSettings = registerPlugin<AndroidNotificationSettingsPlugin>(
  "AndroidNotificationSettings",
);

export async function openAndroidNotificationSettings() {
  if (!isNativeAndroid()) {
    return false;
  }

  const result = await AndroidNotificationSettings.openNotificationSettings();
  return result.opened;
}
