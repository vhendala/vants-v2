import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In development the API runs on :3100; in the PoC the API serves the built app itself (same origin, T-021).
const api = "http://127.0.0.1:3100";

// Link previews need absolute URLs (og:url, og:image): the hosted domain unless PUBLIC_BASE_URL names another (DEC-046).
const publicUrl = (process.env.PUBLIC_BASE_URL ?? "https://vants.example.com").replace(/\/$/, "");

export default defineConfig({
  plugins: [
    react(),
    { name: "vants-public-url", transformIndexHtml: (html) => html.replaceAll("%PUBLIC_URL%", publicUrl) },
  ],
  server: {
    proxy: { "/app": api, "/auth": api, "/.well-known": api },
  },
});
