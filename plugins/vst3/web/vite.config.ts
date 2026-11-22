import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The plugin serves the page from inside its bundle, at no address a file can name.
  base: './',
  build: { assetsInlineLimit: 0 },
});
