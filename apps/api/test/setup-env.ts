const TEST_SESSION_SECRET = 'test-only-secret-0000000000000000000000000000';
const TEST_QR_SECRET = Buffer.alloc(32, 7).toString('base64');

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET ??= TEST_SESSION_SECRET;
process.env.DATABASE_URL ??= 'postgres://hadir:hadir@localhost:5432/hadir';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.WEB_ORIGIN ??= 'http://localhost:5173';
process.env.DEV_TOOLS ??= 'false';
process.env.CONTACT_ENCRYPTION_KEY ??= Buffer.alloc(32, 11).toString('base64');
process.env.UPLOAD_ROOT ??= '.uploads-test';
process.env.QR_KEYRING_JSON ??= JSON.stringify({
  '202610': {
    id: 'k1',
    secret: TEST_QR_SECRET,
  },
});
