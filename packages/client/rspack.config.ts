/**
 * Rspack production build config with Module Federation host.
 *
 * Vite stays for dev HMR; Rspack handles production builds so external
 * plugins can load at runtime via Module Federation v1.5.
 *
 * Shared scope: react, react-dom, @blackbelt-technology/dashboard-plugin-runtime
 *   (all singleton to prevent dual-instance bugs).
 *
 * See change: runtime-plugin-loading (Decision 1, spec: module-federation-host).
 */
import { defineConfig } from "@rspack/cli";
import rspack from "@rspack/core";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { aliases, extensions } from "./build-config.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  entry: {
    main: "./src/main.tsx",
  },

  output: {
    path: path.resolve(__dirname, "dist"),
    publicPath: "auto",
    filename: "assets/[name].[contenthash:8].js",
    chunkFilename: "assets/[name].[contenthash:8].js",
    cssFilename: "assets/[name].[contenthash:8].css",
    clean: true,
  },

  resolve: {
    extensions,
    alias: aliases,
    // Map .js → .ts for workspace packages that use TypeScript's
    // .js extension convention (import './foo.js' → ./foo.ts).
    extensionAlias: {
      ".js": [".ts", ".tsx", ".js", ".jsx"],
      ".jsx": [".tsx", ".ts", ".jsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    },
  },

  module: {
    rules: [
      // TypeScript / TSX via SWC (React automatic JSX runtime).
      {
        test: /\.tsx?$/,
        use: {
          loader: "builtin:swc-loader",
          options: {
            jsc: {
              parser: { syntax: "typescript", tsx: true },
              transform: { react: { runtime: "automatic" } },
            },
          },
        },
        type: "javascript/auto",
      },
      // CSS with PostCSS (Tailwind v4).
      {
        test: /\.css$/,
        use: ["postcss-loader"],
        type: "css",
      },
      // Static assets (images, icons, fonts).
      {
        test: /\.(png|jpe?g|gif|svg|ico|woff2?)$/,
        type: "asset",
      },
    ],
  },

  plugins: [
    // HTML template (production template — no Vite module script).
    new rspack.HtmlRspackPlugin({
      template: "./src/index.rspack.html",
      scriptLoading: "module",
    }),

    // CSS is auto-extracted via experiments.css (Rspack 1.x native).
    // Output filenames are controlled via output.cssFilename.

    // Copy public assets (favicons, manifest, service worker).
    new rspack.CopyRspackPlugin({
      patterns: [{ from: "../../public", to: "." }],
    }),

    // Module Federation host — shares React + runtime with remotes.
    new rspack.container.ModuleFederationPlugin({
      name: "dashboardHost",
      shared: {
        react: {
          singleton: true,
          requiredVersion: "^19.0.0",
          eager: true,
        },
        "react-dom": {
          singleton: true,
          requiredVersion: "^19.0.0",
          eager: true,
        },
        "@blackbelt-technology/dashboard-plugin-runtime": {
          singleton: true,
          eager: true,
          requiredVersion: false,
        },
      },
    }),
  ],

  // Enable CSS support explicitly (default in 1.x, but explicit avoids edge cases).
  experiments: {
    css: true,
  },

  // Infrastructure logging noise reduction.
  stats: "errors-warnings",

  // Source maps for production debugging.
  devtool: "source-map",
});
