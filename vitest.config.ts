// Certification scenarios run full order pipelines (scrypt hashing, file I/O), so allow more than vitest's 5 s default.
export default { test: { testTimeout: 60_000, hookTimeout: 60_000, exclude: ['**/node_modules/**', 'tests/e2e/**'] } };
