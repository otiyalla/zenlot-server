/** @type {import('jest').Config} */

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  //rootDir: "src",
  testRegex: ['.*\\.spec\\.ts$', '.*\\.e2e-spec\\.ts$'],
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/src/$1',
    // expo-server-sdk is ESM (node:assert + undici) which the CommonJS ts-jest
    // transform can't load in unit tests; use a lightweight mock instead.
    '^expo-server-sdk$': '<rootDir>/test/mocks/expo-server-sdk.ts',
  },
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: './coverage',
  coveragePathIgnorePatterns: [
    '/node_modules/',
    'jest.config.js',
  ],
};
