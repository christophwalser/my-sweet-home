// Setup of the unit tests (vitest.config.ts): a fixed English system language, so number
// formats and the user interface language do not depend on the machine running the tests.

Object.defineProperty(globalThis.navigator, "language", {
  value: "en-US",
  configurable: true,
});
