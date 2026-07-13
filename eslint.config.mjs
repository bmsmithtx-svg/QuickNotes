import js from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import nextParser from "eslint-config-next/parser";
import globals from "globals";

const projectFiles = [
  "src/**/*.{js,jsx,ts,tsx}",
  "scripts/**/*.{js,ts,mjs,cjs,mts,cts}"
];

const configFiles = ["next.config.*", "postcss.config.*", "eslint.config.*"];

const eslintConfig = [
  {
    ignores: [".next/**", "out/**", "build/**", "dist/**", "coverage/**", "node_modules/**", "next-env.d.ts"]
  },
  {
    files: projectFiles,
    plugins: {
      "@next/next": nextPlugin
    },
    languageOptions: {
      parser: nextParser,
      parserOptions: {
        requireConfigFile: false,
        sourceType: "module",
        allowImportExportEverywhere: true,
        babelOptions: {
          parserOpts: {
            plugins: ["typescript", "jsx", "importAttributes", "topLevelAwait"]
          }
        }
      },
      globals: {
        ...globals.browser,
        ...globals.node
      }
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules
    }
  },
  {
    files: configFiles,
    languageOptions: {
      globals: {
        ...globals.node
      }
    },
    rules: {
      ...js.configs.recommended.rules
    }
  }
];

export default eslintConfig;
