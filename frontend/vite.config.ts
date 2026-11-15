import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig(({ mode }) => ({
  appType: "spa",
  base: mode === "pwa" ? "/app/" : "/",
  plugins: [
    react(),
    ...(mode === "pwa" ? [{
      name: "fields-pwa-html",
      transformIndexHtml(html: string) {
        return html.replace(
          "</head>",
          "    <meta name=\"theme-color\" content=\"#171717\" />\n    <meta name=\"apple-mobile-web-app-capable\" content=\"yes\" />\n    <meta name=\"apple-mobile-web-app-status-bar-style\" content=\"default\" />\n    <link rel=\"icon\" href=\"/app/icon-192.png\" type=\"image/png\" />\n    <link rel=\"manifest\" href=\"/app/manifest.webmanifest\" />\n  </head>",
        );
      },
    }] : []),
  ],
  resolve: {
    alias: {
      "@lobechat/conversation-flow": fileURLToPath(new URL("./vendor/lobehub/conversation-flow/index.ts", import.meta.url)),
      "@lobechat/types": fileURLToPath(new URL("./vendor/lobehub/types/index.ts", import.meta.url)),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 3103,
    strictPort: true,
  },
  build: {
    assetsDir: "assets",
    outDir: mode === "pwa" ? "artifacts/pwa" : "artifacts/renderer",
    sourcemap: mode !== "desktop",
    target: "es2022",
  },
}));
