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

  evictFromMemory() {
    const entries = Array.from(this.memoryCache.entries());
    
    entries.sort((a, b) => {
      const scoreA = a[1].lastAccessed * a[1].priority;
      const scoreB = b[1].lastAccessed * b[1].priority;
      return scoreA - scoreB;
    });
    
    const evictCount = Math.max(1, Math.floor(this.memoryLimit * 0.1));
    for (let i = 0; i < evictCount; i++) {
      this.memoryCache.delete(entries[i][0]);
    }
  }

  recordHit(key) {
    const count = this.hitCounter.get(key) || 0;
    this.hitCounter.set(key, count + 1);
  }

  calculateSize(obj) {
    return new Blob([JSON.stringify(obj)]).size;
  }

  async del(key) {
    this.memoryCache.delete(key);
    
    if (this.redisClient) {
      await this.redisClient.del(key);
    }
  }

  async clear() {
    this.memoryCache.clear();
    this.hitCounter.clear();
    
    if (this.redisClient) {
      await this.redisClient.flushdb();
    }
  }

  getStats() {
    return {
      ...this.stats,
      hitRate: this.stats.hits / (this.stats.hits + this.stats.misses),
      memorySize: this.memoryCache.size,
      topHits: Array.from(this.hitCounter.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
    };
  }
}

class IntelligentAPICache {
  constructor(options = {}) {
    this.cache = new HybridCache(options);
    this.pendingRequests = new Map();
    this.circuitBreaker = new CircuitBreaker();
    this.requestQueue = new Map();
  }

  async cachedFetch(url, options = {}) {
    const {
      ttl = 300000,
      forceRefresh = false,
      deduplicate = true,
      fallback = null,
      validate = null
    } = options;

    const cacheKey = this.generateCacheKey(url, options);
    
    if (!forceRefresh) {
      const cached = await this.cache.get(cacheKey);
      if (cached && (!validate || validate(cached))) {
        return cached;
      }
    }

    if (deduplicate && this.pendingRequests.has(cacheKey)) {
      return new Promise((resolve, reject) => {
        const queue = this.requestQueue.get(cacheKey) || [];
        queue.push({ resolve, reject });
        this.requestQueue.set(cacheKey, queue);
      });
    }

    this.pendingRequests.set(cacheKey, true);

    try {
      if (!this.circuitBreaker.canRequest(url)) {
        throw new Error('Circuit breaker open');
      }

      const response = await fetch(url, options);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      
      await this.cache.set(cacheKey, data, { ttl });
      
      this.processQueue(cacheKey, data);
      
      return data;
    } catch (error) {
      this.circuitBreaker.recordFailure(url);
      
      if (fallback === 'stale') {
        const stale = await this.cache.get(cacheKey, { skipRedis: true });
        if (stale) {
          console.warn('Returning stale data due to error:', error.message);
          this.processQueue(cacheKey, stale);
          return stale;
        }
      }
      
      this.processQueue(cacheKey, null, error);
      throw error;
    } finally {
      this.pendingRequests.delete(cacheKey);
    }
  }

  processQueue(cacheKey, data, error = null) {
    const queue = this.requestQueue.get(cacheKey) || [];
    
    queue.forEach(({ resolve, reject }) => {
      if (error) {
        reject(error);
      } else {
        resolve(data);
      }
    });
    
    this.requestQueue.delete(cacheKey);
  }

  generateCacheKey(url, options) {
    const { headers = {}, body, method = 'GET' } = options;
    
    const keyData = {
      url,
      method,
      headers: this.sanitizeHeaders(headers),
      body: body ? this.hashString(JSON.stringify(body)) : null
    };
    
    return `api:${this.hashString(JSON.stringify(keyData))}`;
  }

  sanitizeHeaders(headers) {
    const sensitive = ['authorization', 'cookie', 'x-api-key'];
    const sanitized = { ...headers };
    
    sensitive.forEach(header => {
      if (sanitized[header]) {
        sanitized[header] = '***';
      }
    });
    
    return sanitized;
  }

  hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(36);
  }

  async preload(urls, options = {}) {
    const promises = urls.map(url => 
      this.cachedFetch(url, { ...options, deduplicate: false })
        .catch(error => {
          console.warn(`Preload failed for ${url}:`, error.message);
          return null;
        })
    );
    
    return Promise.all(promises);
  }
}
