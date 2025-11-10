class HybridCache {
  constructor(options = {}) {
    this.memoryCache = new Map();
    this.redisClient = options.redisClient || null;
    this.defaultTTL = options.defaultTTL || 300000;
    this.memoryLimit = options.memoryLimit || 100;
    this.hitCounter = new Map();
    this.stats = {
      hits: 0,
      misses: 0,
      memoryHits: 0,
      redisHits: 0
    };
  }
}
