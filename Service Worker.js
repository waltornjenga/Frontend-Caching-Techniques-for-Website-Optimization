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
}

// Instantiate the service worker
new AdvancedServiceWorker();
