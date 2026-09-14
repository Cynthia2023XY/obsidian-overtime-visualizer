import tseslint from "typescript-eslint";
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { globalIgnores } from "eslint/config";

/** 适用于 Obsidian TypeScript 源码的 ESLint 配置 */
const eslintConfig = tseslint.config(
  {
    languageOptions: {
      globals: {
        ...globals.browser,
      },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  ...obsidianmd.configs.recommended,
  globalIgnores([
    "node_modules",
    "main.js",
    "esbuild.config.mjs",
    "version-bump.mjs",
  ]),
);

export default eslintConfig;
