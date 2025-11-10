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

  setHeaders(res, type, content, options = {}) {
    const config = { ...this.config[type], ...options };
    const directives = this.buildCacheDirectives(config);
    res.setHeader('Cache-Control', directives.join(', '));
    
    if (config.vary) {
      res.setHeader('Vary', config.vary);
    }

    return true;
  }

  buildCacheDirectives(config) {
    const directives = [];
    
    if (config.private) {
      directives.push('private');
    } else {
      directives.push('public');
    }

    if (config.noCache || config.maxAge === 0) {
      directives.push('no-cache', 'must-revalidate');
    } else {
      directives.push(`max-age=${config.maxAge}`);
      
      if (config.staleWhileRevalidate) {
        directives.push(`stale-while-revalidate=${config.staleWhileRevalidate}`);
      }
      
      if (config.staleIfError) {
        directives.push(`stale-if-error=${config.staleIfError}`);
      }
      
      if (config.immutable) {
        directives.push('immutable');
      }
    }

    if (config.noStore) {
      directives.push('no-store');
    }

    return directives;
  }

  generateETag(content) {
    if (typeof content === 'string') {
      return `"${crypto.createHash('md5').update(content).digest('hex')}"`;
    }
    
    // For file content or buffers
    return `"${crypto.createHash('md5').update(JSON.stringify(content)).digest('hex')}"`;
  }
}
