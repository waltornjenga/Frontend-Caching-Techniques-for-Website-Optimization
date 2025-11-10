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

  async get(key, options = {}) {
    const { skipMemory = false, skipRedis = false } = options;
    
    if (!skipMemory) {
      const memoryResult = this.getFromMemory(key);
      if (memoryResult !== null) {
        this.stats.hits++;
        this.stats.memoryHits++;
        this.recordHit(key);
        return memoryResult;
      }
    }

    if (this.redisClient && !skipRedis) {
      try {
        const redisResult = await this.getFromRedis(key);
        if (redisResult !== null) {
          this.stats.hits++;
          this.stats.redisHits++;
          this.recordHit(key);
          
          this.setToMemory(key, redisResult, options.ttl);
          return redisResult;
        }
      } catch (error) {
        console.warn('Redis cache failed, falling back:', error);
      }
    }

    this.stats.misses++;
    return null;
  }

  async set(key, value, options = {}) {
    const ttl = options.ttl || this.defaultTTL;
    const priority = options.priority || 1;
    
    this.setToMemory(key, value, ttl, priority);
    
    if (this.redisClient) {
      try {
        await this.setToRedis(key, value, ttl);
      } catch (error) {
        console.warn('Redis set failed:', error);
      }
    }
    
    return true;
  }
}
