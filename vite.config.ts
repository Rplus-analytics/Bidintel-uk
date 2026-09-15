import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/supabase/vite";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  // amazon-cognito-identity-js (the Cognito SRP client) depends on buffer@4.9.2,
  // which is a Node shim that references the bare identifier `global`. Browsers
  // have no `global`, so the module throws at import time:
  //
  //   ReferenceError: global is not defined
  //     at node_modules/buffer/index.js
  //
  // and because it is imported from the auth layer, which App.tsx pulls in at
  // the top of the module graph, React never mounts and the page renders BLANK
  // with no visible error. Aliasing it to globalThis is the standard fix and is
  // scoped to this one identifier.
  define: {
    global: "globalThis",
  },
  plugins: [react(), mcpPlugin(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
}));
