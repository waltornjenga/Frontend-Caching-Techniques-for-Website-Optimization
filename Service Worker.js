// service-worker.js
class AdvancedServiceWorker {
  constructor() {
    this.version = 'v2.1.0';
    this.cacheConfig = {
      static: {
        name: 'static-cache',
        strategies: ['cache-first'],
        patterns: [/\.(css|js)$/, /\.(png|jpg|jpeg|svg|webp)$/],
        maxEntries: 100,
        maxAgeSeconds: 86400 * 30 // 30 days
      },
      api: {
        name: 'api-cache',
        strategies: ['network-first'],
        patterns: [/\/api\//],
        maxEntries: 50,
        maxAgeSeconds: 300 // 5 minutes
      },
      pages: {
        name: 'pages-cache',
        strategies: ['network-first'],
        patterns: [/\.html$/, /\//],
        maxEntries: 20,
        maxAgeSeconds: 3600 // 1 hour
      }
    };
    this.init();
  }

  init() {
    self.addEventListener('install', this.handleInstall.bind(this));
    self.addEventListener('activate', this.handleActivate.bind(this));
    self.addEventListener('fetch', this.handleFetch.bind(this));
    self.addEventListener('message', this.handleMessage.bind(this));
  }

  async handleInstall(event) {
    self.skipWaiting();
    
    const cacheKeys = Object.values(this.cacheConfig).map(config => config.name);
    const cachePromises = cacheKeys.map(cacheName => 
      caches.open(`${this.version}-${cacheName}`)
    );
    
    event.waitUntil(Promise.all(cachePromises));
  }

  async handleActivate(event) {
    const expectedCacheKeys = Object.values(this.cacheConfig)
      .map(config => `${this.version}-${config.name}`);
    
    const cacheKeys = await caches.keys();
    const deletePromises = cacheKeys.map(cacheName => {
      if (!expectedCacheKeys.includes(cacheName)) {
        return caches.delete(cacheName);
      }
    });

    event.waitUntil(Promise.all(deletePromises));
    await self.clients.claim();
  }

  async handleFetch(event) {
    const request = event.request;
    
    // Skip non-GET requests
    if (request.method !== 'GET') return;

    // Skip cross-origin requests
    if (!this.isSameOrigin(request)) return;

    const strategy = this.getCacheStrategy(request);
    
    try {
      const response = await this[strategy](request);
      event.respondWith(response);
    } catch (error) {
      console.error(`Cache strategy ${strategy} failed:`, error);
      event.respondWith(this.networkOnly(request));
    }
  }

  handleMessage(event) {
    const { type, payload } = event.data;
    
    switch (type) {
      case 'SKIP_WAITING':
        self.skipWaiting();
        break;
      case 'CLEAR_CACHE':
        this.clearCache(payload);
        break;
    }
  }

  async clearCache(types = []) {
    const cacheKeys = types.length > 0 
      ? types.map(type => `${this.version}-${this.cacheConfig[type].name}`)
      : await caches.keys();
    
    const deletePromises = cacheKeys.map(cacheName => caches.delete(cacheName));
    await Promise.all(deletePromises);
  }

  getCacheStrategy(request) {
    const url = new URL(request.url);
    
    for (const [type, config] of Object.entries(this.cacheConfig)) {
      if (config.patterns.some(pattern => pattern.test(url.pathname))) {
        return config.strategies[0].replace('-', '_');
      }
    }
    
    return 'network_first';
  }

  async cache_first(request) {
    const cache = await this.getCache('static');
    const cachedResponse = await cache.match(request);
    
    if (cachedResponse) {
      // Background update
      this.updateCache(request, cache);
      return cachedResponse;
    }

    return this.networkOnly(request);
  }

  async network_first(request) {
    try {
      const networkResponse = await fetch(request);
      
      if (networkResponse.ok) {
        const cache = await this.getCache('api');
        cache.put(request, networkResponse.clone());
        return networkResponse;
      }
      
      throw new Error('Network response not ok');
    } catch (error) {
      const cache = await this.getCache('api');
      const cachedResponse = await cache.match(request);
      
      if (cachedResponse) {
        return cachedResponse;
      }
      
      return this.getFallbackResponse(request);
    }
  }

  async network_only(request) {
    return fetch(request);
  }

  async getCache(type) {
    const config = this.cacheConfig[type];
    return caches.open(`${this.version}-${config.name}`);
  }

  async updateCache(request, cache) {
    try {
      const networkResponse = await fetch(request);
      if (networkResponse.ok) {
        await cache.put(request, networkResponse.clone());
      }
    } catch (error) {
      // Silent fail - we have cached version
    }
  }

  getFallbackResponse(request) {
    const url = new URL(request.url);
    
    if (url.pathname.endsWith('.html')) {
      return caches.match('/offline.html');
    }
    
    return new Response('Offline', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' }
    });
  }

  isSameOrigin(request) {
    const url = new URL(request.url);
    return url.origin === self.location.origin;
  }
}

// Instantiate the service worker
new AdvancedServiceWorker();
