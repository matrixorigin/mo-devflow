import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiPort = env.MO_DEVFLOW_API_PORT || "18081";
  return {
    plugins: [react()],
    server: {
      host: "0.0.0.0",
      port: Number(env.MO_DEVFLOW_WEB_PORT || "5173"),
      proxy: {
        "/api": `http://127.0.0.1:${apiPort}`,
        "/health": `http://127.0.0.1:${apiPort}`
      }
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            react: ["react", "react-dom"],
            antd: ["antd"],
            icons: ["lucide-react"],
            charts: ["echarts"]
          }
        }
      }
    }
  };
});
