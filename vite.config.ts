import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import type { UserConfig } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "VITE_");

  const allowedHosts = (env.VITE_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim())
    .filter((host) => host !== "");

  const server: NonNullable<UserConfig["server"]> = {
    proxy: {
      "/api": "http://127.0.0.1:3000",
      "/__test__": "http://127.0.0.1:3000",
    },
  };

  if (allowedHosts.length > 0) {
    server.allowedHosts = allowedHosts;
  }

  return {
    plugins: [tailwindcss(), react()],
    build: {
      outDir: "dist",
      rolldownOptions: {
        input: { main: "index.html", sw: "src/web/sw.ts" },
        output: {
          codeSplitting: {
            groups: [
              {
                name: "react-vendor",
                priority: 40,
                test: /node_modules\/(?:react|react-dom|scheduler|react-router|clsx)\//u,
              },
              {
                name: "charts",
                priority: 30,
                test: /node_modules\/(?:recharts|d3-[^/]+|victory-vendor|recharts-scale)\//u,
              },
              {
                name: "dnd",
                priority: 30,
                test: /node_modules\/@dnd-kit\//u,
              },
              {
                name: "motion",
                priority: 30,
                test: /node_modules\/(?:motion|motion-dom|motion-utils|framer-motion)\//u,
              },
              {
                name: "radix",
                priority: 25,
                test: /node_modules\/@radix-ui\//u,
              },
            ],
          },
          entryFileNames: (chunk) => (chunk.name === "sw" ? "sw.js" : "assets/[name]-[hash].js"),
        },
      },
    },
    server,
  };
});
