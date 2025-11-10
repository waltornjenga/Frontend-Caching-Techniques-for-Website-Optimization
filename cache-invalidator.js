class CacheInvalidationManager {
  constructor() {
    this.version = '1.0.0';
    this.dependencies = new Map();
    this.invalidationStrategies = new Map();
    this.backgroundSync = new BackgroundSyncManager();
    
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
}
