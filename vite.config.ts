import { defineConfig, loadEnv } from "vite"
import react from "@vitejs/plugin-react"
import { fileURLToPath, URL } from "url"

export default defineConfig(({ mode }) => {
  // Load env variables based on current mode (e.g. development or production)
  const env = loadEnv(mode, process.cwd(), "")

  // Extract URLs from .env file
  const KRATOS_URL = env.VITE_ORY_SDK_URL || "http://localhost:4433"
  const HYDRA_ADMIN_URL = env.VITE_HYDRA_ADMIN_URL || "http://localhost:4445"
  const HYDRA_PUBLIC_URL = env.VITE_HYDRA_PUBLIC_URL || "http://localhost:4444"

  return {
    plugins: [react()],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    server: {
      port: 5173,
      cors: true,
      proxy: {
        // Hydra Admin API
        "/hydra-admin": {
          target: HYDRA_ADMIN_URL,
          changeOrigin: true,
          secure: false,
          rewrite: (path) => path.replace(/^\/hydra-admin/, ""),
        },

        // Kratos public API
        "/kratos": {
          target: KRATOS_URL,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/kratos/, ""),
        },

        // Hydra Public API
        "/public-hydra": {
          target: HYDRA_PUBLIC_URL,
          changeOrigin: true,
          secure: false,
          rewrite: (path) => path.replace(/^\/public-hydra/, ""),
        },
      },
    },
  }
})
