import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";

export default defineConfig({
  test: {
    name: "adapter-claude-component",
    include: ["test/component/**/*.browser.test.ts"],
    testTimeout: 10_000,
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      screenshotFailures: false,
      instances: [{ browser: "chromium" }]
    }
  }
});
