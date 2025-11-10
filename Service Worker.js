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
      }
    };
    this.init();
  }

  init() {
    self.addEventListener('install', this.handleInstall.bind(this));
    self.addEventListener('activate', this.handleActivate.bind(this));
  }
}

// Instantiate the service worker
new AdvancedServiceWorker();
