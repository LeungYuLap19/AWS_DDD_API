const MIN_TEST_TIMEOUT_MS = 60000;

const originalSetTimeout = jest.setTimeout.bind(jest);

jest.setTimeout = (timeoutMs) => originalSetTimeout(Math.max(timeoutMs, MIN_TEST_TIMEOUT_MS));
originalSetTimeout(MIN_TEST_TIMEOUT_MS);
