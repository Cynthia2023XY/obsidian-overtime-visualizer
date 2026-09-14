import { defineConfig } from "vitest/config";

/** 核心计算与轻量 DOM 测试的 Vitest 配置 */
const vitestConfig = defineConfig({
  test: {
    testTimeout: 5_000,
    environment: "jsdom",
    include: ["src/**/*-test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      reportsDirectory: "coverage",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*-test.ts", "src/types/**", "src/mocks/**", "src/main.ts"],
    },
  },
});

export default vitestConfig;
