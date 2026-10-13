process.env.NODE_ENV = 'test';
process.env.MONGO_URI = 'mongodb://localhost:27017/unused-in-tests';
process.env.INTERNAL_SERVICE_SECRET = 'test-internal-secret-123456';
process.env.AI_RATE_LIMIT_PER_MIN = '1000';
