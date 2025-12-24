import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // Expose to network
    port: 5173, // Use port 5173 (backend expects this)
    strictPort: true, // Fail if port is in use instead of trying another
  }
})
