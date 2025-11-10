// cache-headers.js
import crypto from 'crypto';

class CacheHeaderManager {
  constructor() {
    this.etagCache = new Map();
    this.config = {
      static: {
        maxAge: 31536000, // 1 year
        immutable: true,
        vary: 'Accept-Encoding'
      },
      dynamic: {
        maxAge: 3600, // 1 hour
        staleWhileRevalidate: 86400, // 24 hours
        vary: 'Accept-Encoding, Cookie'
      },
      api: {
        maxAge: 300, // 5 minutes
        staleWhileRevalidate: 3600, // 1 hour
        vary: 'Authorization, Accept-Encoding'
      },
      private: {
        maxAge: 0,
        noCache: true,
        private: true
      }
    };
  }
}
