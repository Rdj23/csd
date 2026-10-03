// Test environment setup — runs before all tests
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret-for-vitest";
process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
