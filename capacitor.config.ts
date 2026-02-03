import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'sportfolio.market',
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
