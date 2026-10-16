import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    strictPort: false,
    // The repo lives on a WSL-mounted Windows drive (9p), where native file
    // events (inotify) are not delivered. Polling is required or HMR never
    // sees edits. node_modules/dist are polled-over to keep CPU reasonable.
    watch: {
      usePolling: true,
      interval: 300,
      ignored: ['**/node_modules/**', '**/dist/**', '**/.git/**'],
    },
  },
})
