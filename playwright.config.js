import { defineConfig } from "@playwright/test";

const PORT = process.env.PORT || 5173;
const BASE = `http://127.0.0.1:${PORT}`;

const mobile = (browserName, width, height, dsf = 2) => ({
  browserName,
  viewport: { width, height },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: dsf,
});

export default defineConfig({
  testDir: "tests",
  testMatch: /.*\.spec\.js/,
  timeout: 60_000,
  expect: { timeout: 8_000 },
  fullyParallel: true,
  reporter: [["list"]],
  outputDir: `test-results/${PORT}`,
  use: { baseURL: BASE, trace: "retain-on-failure" },
  webServer: {
    command: `npx serve . -l ${PORT}`,
    url: BASE,
    reuseExistingServer: !process.env.PORT,
    timeout: 60_000,
  },
  projects: [
    { name: "iphone-se", use: mobile("webkit", 375, 667) },
    { name: "iphone-15", use: mobile("webkit", 393, 852, 3) },
    { name: "pixel", use: mobile("chromium", 412, 915, 2.625) },
    { name: "ipad", use: mobile("webkit", 768, 1024) },
    { name: "desktop-1280", use: { browserName: "chromium", viewport: { width: 1280, height: 800 } } },
    { name: "desktop-1440", use: { browserName: "chromium", viewport: { width: 1440, height: 900 } } },
  ],
});
