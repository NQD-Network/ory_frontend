import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import { fileURLToPath, URL } from "url"

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    cors: true, // 🔹 Enable CORS for dev server
    proxy: {
      // Hydra Admin API
      "/hydra-admin": {
        target: "http://localhost:4445",
        changeOrigin: true,
        secure: false,       // 🔹 In case Hydra Admin uses self-signed cert
        rewrite: (path) => path.replace(/^\/hydra-admin/, ""),
        // configure: (proxy, options) => {
        //   proxy.on("proxyReq", (proxyReq, req, res) => {
        //     // Optional: log outgoing requests

        //   })
        // },
      },

      // Kratos public API
      "/kratos": {
        target: "http://localhost:4433",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/kratos/, ""),
      },

      // Hydra Public API (for /oauth2/token)
      "/public-hydra": {
        target: "http://localhost:4444",
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/public-hydra/, ""),
        // configure: (proxy) => {
        //   proxy.on("proxyReq", (proxyReq, req) => {
        //     console.log("➡ Proxying request:", req.url)
        //   })
        // }
      },
    },
  },
})
