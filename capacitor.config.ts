import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.sportfolio.app',
  appName: 'Sportfolio',
  webDir: 'client/dist',
  ios: {
    path: 'mobile/ios'
  },
  android: {
    path: 'mobile/android'
  }
};

export default config;
