class CacheInvalidationManager {
  constructor() {
    this.version = '1.0.0';
    this.dependencies = new Map();
    this.invalidationStrategies = new Map();
    this.backgroundSync = new BackgroundSyncManager();
    this.memoryCache = new Map();
    this.hitCount = 0;
    
    this.setupStrategies();
  }

  setupStrategies() {
    this.invalidationStrategies.set('time-based', {
      check: (cacheEntry, options) => {
        const age = Date.now() - cacheEntry.timestamp;
        return age > (options.maxAge || 3600000);
      },
      action: 'refresh'
    });

    this.invalidationStrategies.set('version-based', {
      check: (cacheEntry, options) => {
        return cacheEntry.version !== options.currentVersion;
      },
      action: 'clear'
    });

    this.invalidationStrategies.set('dependency-based', {
      check: (cacheEntry, options) => {
        return options.dependencies.some(dep => 
          this.hasDependencyChanged(dep, cacheEntry.dependencies)
        );
      },
      action: 'clear'
    });

    this.invalidationStrategies.set('usage-based', {
      check: (cacheEntry, options) => {
        const { maxSize = 100, minHits = 1 } = options;
        return cacheEntry.accessCount < minHits && 
               this.getTotalCacheSize() > maxSize;
      },
      action: 'clear'
    });
  }

  async invalidateCache(key, strategy = 'time-based', options = {}) {
    const cacheEntry = await this.getCacheEntry(key);
    
    if (!cacheEntry) return false;

    const strategyConfig = this.invalidationStrategies.get(strategy);
    if (!strategyConfig) {
      throw new Error(`Unknown invalidation strategy: ${strategy}`);
    }

    const shouldInvalidate = strategyConfig.check(cacheEntry, options);
    
    if (shouldInvalidate) {
      switch (strategyConfig.action) {
        case 'clear':
          await this.clearCache(key);
          break;
        case 'refresh':
          await this.refreshCache(key, cacheEntry);
          break;
        case 'stale':
          await this.markAsStale(key);
          break;
      }
      return true;
    }

    return false;
  }

  async smartRefresh(key, fetchFn, options = {}) {
    const {
      strategies = ['time-based', 'dependency-based'],
      backgroundRefresh = true,
      fallbackToStale = true
    } = options;

    for (const strategy of strategies) {
      const shouldRefresh = await this.invalidateCache(key, strategy, options);
      if (shouldRefresh) {
        if (backgroundRefresh) {
          this.backgroundSync.scheduleRefresh(key, fetchFn);
          if (fallbackToStale) {
            return this.getStaleData(key);
          }
        } else {
          return this.refreshAndGet(key, fetchFn);
        }
      }
    }

    return this.getCacheData(key);
  }

  async refreshAndGet(key, fetchFn) {
    try {
      const freshData = await fetchFn();
      await this.setCache(key, freshData);
      return freshData;
    } catch (error) {
      const staleData = await this.getStaleData(key);
      if (staleData) {
        console.warn('Using stale data due to refresh failure:', error.message);
        return staleData;
      }
      throw error;
    }
  }

  async getStaleData(key) {
    const entry = await this.getCacheEntry(key);
    return entry ? entry.data : null;
  }

  registerDependency(parentKey, dependencyKeys) {
    this.dependencies.set(parentKey, {
      keys: dependencyKeys,
      version: Date.now()
    });
  }

  hasDependencyChanged(dependencyKey, cachedDependencies) {
    const currentDep = this.dependencies.get(dependencyKey);
    const cachedDep = cachedDependencies?.[dependencyKey];
    
    return currentDep && currentDep.version !== cachedDep?.version;
  }

  async setCache(key, data, options = {}) {
    const entry = {
      data,
      timestamp: Date.now(),
      version: this.version,
      dependencies: options.dependencies || {},
      accessCount: 0,
      size: this.calculateSize(data),
      metadata: options.metadata || {}
    };

    if (options.priority === 'high') {
      await this.setToMemoryCache(key, entry);
    }
    
    await this.setToLocalStorage(key, entry);
    
    if (options.persistent) {
      await this.setToIDB(key, entry);
    }
  }

  async getCacheEntry(key) {
    let entry = await this.getFromMemoryCache(key);
    
    if (!entry) {
      entry = await this.getFromLocalStorage(key);
    }
    
    if (!entry && await this.hasIDBEntry(key)) {
      entry = await this.getFromIDB(key);
    }

    if (entry) {
      entry.accessCount++;
      await this.updateAccessTime(key, entry);
    }

    return entry;
  }

  calculateSize(obj) {
    const str = typeof obj === 'string' ? obj : JSON.stringify(obj);
    return new TextEncoder().encode(str).length;
  }

  getTotalCacheSize() {
    let total = 0;
    for (const [key, entry] of this.memoryCache) {
      total += entry.size;
    }
    return total;
  }

  async invalidateByPattern(pattern, strategy = 'time-based') {
    const keys = await this.getCacheKeys();
    const matchingKeys = keys.filter(key => key.match(pattern));
    
    const results = await Promise.allSettled(
      matchingKeys.map(key => this.invalidateCache(key, strategy))
    );
    
    return {
      total: matchingKeys.length,
      invalidated: results.filter(r => r.status === 'fulfilled' && r.value).length,
      failed: results.filter(r => r.status === 'rejected').length
    };
  }

  async warmCache(keysWithUrls, options = {}) {
    const { concurrency = 3, ttl = 3600000 } = options;
    
    const batches = this.chunkArray(keysWithUrls, concurrency);
    
    for (const batch of batches) {
      await Promise.allSettled(
        batch.map(async ({ key, url }) => {
          try {
            const response = await fetch(url);
            const data = await response.json();
            await this.setCache(key, data, { ttl, ...options });
          } catch (error) {
            console.warn(`Cache warming failed for ${key}:`, error.message);
          }
        })
      );
    }
  }

  chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}
