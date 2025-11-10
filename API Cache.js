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

  getFromMemory(key) {
    const item = this.memoryCache.get(key);
    
    if (!item) return null;
    
    if (Date.now() > item.expiry) {
      this.memoryCache.delete(key);
      return null;
    }
    
    item.lastAccessed = Date.now();
    return item.value;
  }

  setToMemory(key, value, ttl, priority = 1) {
    if (this.memoryCache.size >= this.memoryLimit) {
      this.evictFromMemory();
    }
    
    this.memoryCache.set(key, {
      value,
      expiry: Date.now() + ttl,
      lastAccessed: Date.now(),
      priority,
      size: this.calculateSize(value)
    });
  }

  async getFromRedis(key) {
    if (!this.redisClient) return null;
    
    const value = await this.redisClient.get(key);
    if (!value) return null;
    
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  async setToRedis(key, value, ttl) {
    if (!this.redisClient) return;
    
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    await this.redisClient.setex(key, Math.ceil(ttl / 1000), serialized);
  }
}
