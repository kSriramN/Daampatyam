import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// A relative base works correctly whether you deploy to GitHub Pages
// (subpath, e.g. /Daampatyam/) or Netlify/Vercel (root domain) — no
// per-platform edits needed.
export default defineConfig({
  plugins: [react()],
  base: "./",
});
