import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: true,
    allowedHosts: ['3000-i6iycesiusu4qhq5xik4e-abfa5334.sg2.manus.computer'],
  },
  preview: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: true,
    allowedHosts: ['3000-i6iycesiusu4qhq5xik4e-abfa5334.sg2.manus.computer'],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/@firebase/firestore')) return 'firebase-firestore';
          if (id.includes('/node_modules/@firebase/auth')) return 'firebase-auth';
          if (id.includes('/node_modules/@firebase/app')) return 'firebase-app';
          if (id.includes('/node_modules/@firebase/')) return 'firebase-shared';
        },
      },
    },
  },
});
