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
  // Node 集成测试不进入插件产物，需要模拟真实文件系统和 CommonJS 宿主
  {
    files: ["tests/export/**/*.ts"],
    rules: { "obsidianmd/no-nodejs-modules": "off" },
  },
  // DOM 宿主助手的底层实现必须使用原生元素创建，业务代码仍遵循助手规则
  {
    files: ["tests/mocks/dom-test-host.ts"],
    rules: { "obsidianmd/prefer-create-el": "off" },
  },
  // 此集成测试主动模拟新旧两种宿主，允许调用两代设置 API 验证兼容行为
  {
    files: ["tests/plugin-settings-tab-test.ts"],
    rules: { "obsidianmd/no-unsupported-api": "off", "@typescript-eslint/no-deprecated": "off" },
  },
  globalIgnores([
    "node_modules",
    "main.js",
    "esbuild.config.mjs",
    "version-bump.mjs",
  ]),
);

export default eslintConfig;
