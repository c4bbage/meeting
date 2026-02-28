import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  server: {
    port: 3000,
    // HTTPS disabled for now - re-enable after SSL cert setup
    // https: {
    //   key: fs.readFileSync(path.resolve(__dirname, '../.ssl/localhost-key.pem')),
    //   cert: fs.readFileSync(path.resolve(__dirname, '../.ssl/localhost.pem'))
    // },
    proxy: {
      '/api': {
        target: 'https://localhost:8443',
        changeOrigin: true,
        secure: false
      }
    }
  },

  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          db: ['dexie']
        }
      }
    }
  },

  optimizeDeps: {
    include: ['react', 'react-dom', 'react-router-dom', 'zustand', 'dexie']
  }
})
