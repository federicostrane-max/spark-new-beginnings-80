import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    watch: {
      // ✅ Escludi cartelle che non servono dal watch per evitare restart
      ignored: ['**/supabase/functions/**', '**/node_modules/**']
    },
    hmr: {
      // ✅ Timeout più lungo per HMR per evitare restart prematuri
      timeout: 60000
    }
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
