import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.tfi.app',
  appName: 'TFI',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  plugins: {
    FirebaseMessaging: {
      presentationOptions: ['alert', 'badge', 'sound'],
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_name',
      iconColor: '#2563eb',
    },
  },
};

export default config;
