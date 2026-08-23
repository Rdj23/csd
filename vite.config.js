import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'


export default defineConfig({
  server: {
    proxy: {
      '/api': 'http://localhost:5000' // Point this to your backend port
    }
  },
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // ── Vendor split ────────────────────────────────────────────────
        // Route-level lazy loading (see the code-splitting note in App.jsx)
        // already took the initial bundle from 450KB to ~224KB gzip. What's
        // left is genuinely needed at first paint, so splitting it further
        // does NOT reduce first-load bytes.
        //
        // It helps REPEAT visits instead. These libraries change only when we
        // upgrade them, while app code changes every deploy. Kept in the same
        // chunk as our code, one line of application change invalidates the
        // whole 734KB for every user. Isolated, the vendor chunk keeps its
        // content hash across deploys and stays in the browser cache — which
        // matters here because this is an internal dashboard the same ~60
        // people reload every day, and it sits behind a Render Free instance
        // whose cold start already costs them ~1 minute.
        //
        // Only leaf libraries with no imports back into app code are listed —
        // a manualChunks entry that straddles the app/vendor boundary is how
        // you get circular-chunk init errors at runtime.
        manualChunks: {
          // 'react-dom/client' must be listed explicitly — main.jsx imports
          // that subpath, and Rollup matches manualChunks on the exact module
          // specifier. Listing only 'react-dom' left the ~130KB renderer in
          // the entry chunk and produced a misleadingly tiny vendor-react.
          'vendor-react': ['react', 'react-dom', 'react-dom/client', 'react-router-dom'],
          'vendor-data': ['@tanstack/react-table', '@tanstack/react-virtual', 'zustand'],
          'vendor-net': ['axios', 'socket.io-client'],
        },
      },
    },
  },
})
