module.exports = {
  testTimeout: 120000,
  setupFilesAfterEnv: ['<rootDir>/jest.setup.cjs'],
  modulePathIgnorePatterns: ['<rootDir>/.aws-sam/', '<rootDir>/dist/'],
};
