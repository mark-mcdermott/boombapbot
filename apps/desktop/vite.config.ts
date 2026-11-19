import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Tauri prints its own lines above Vite's; leave them there.
  clearScreen: false,
  server: { port: 4341, strictPort: true, watch: { ignored: ['**/src-tauri/**'] } },
  preview: { port: 4342, strictPort: true },
});
