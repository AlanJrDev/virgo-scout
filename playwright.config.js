module.exports = {
  testDir: './src/tests',
  timeout: 30000,
  expect: {
    timeout: 5000,
  },
  fullyParallel: true,
  workers: process.env.CI ? 1 : 4,
  reporter: [['html'], ['list']],
  use: {
    baseURL: 'https://www.google.com',
    headless: process.env.HEADLESS !== 'false',
    viewport: { width: 1280, height: 720 },
    actionTimeout: 5000,
    navigationTimeout: 15000,
  },
};
