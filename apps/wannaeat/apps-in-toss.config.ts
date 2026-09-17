import { defineConfig } from '@apps-in-toss/web-framework/config';

export default defineConfig({
  appName: 'wannaeat',
  brand: {
    primaryColor: '#1E634D',
  },
  webView: {},
  permissions: [
    { name: 'photos', access: 'read' },
    { name: 'camera', access: 'access' },
  ],
  webBundleDir: 'dist',
});
