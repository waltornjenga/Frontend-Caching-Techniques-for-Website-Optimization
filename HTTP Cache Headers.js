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
    
    // Generate ETag for content-based caching
    if (content && !config.noCache) {
      const etag = this.generateETag(content);
      res.setHeader('ETag', etag);
      
      // Check If-None-Match header
      if (options.req && options.req.headers['if-none-match'] === etag) {
        res.writeHead(304);
        res.end();
        return false;
      }
    }

    const directives = this.buildCacheDirectives(config);
    res.setHeader('Cache-Control', directives.join(', '));
    
    if (config.vary) {
      res.setHeader('Vary', config.vary);
    }

    // Set Last-Modified if provided
    if (options.lastModified) {
      res.setHeader('Last-Modified', options.lastModified.toUTCString());
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

  // Express middleware
  middleware() {
    return (req, res, next) => {
      res.setCacheHeaders = (type, content, options = {}) => {
        options.req = req;
        return this.setHeaders(res, type, content, options);
      };
      next();
    };
  }

  // Static file handler with smart caching
  staticFileHandler(rootPath) {
    const fs = require('fs').promises;
    const path = require('path');
    
    return async (req, res) => {
      try {
        const filePath = path.join(rootPath, req.path);
        const stats = await fs.stat(filePath);
        
        if (!stats.isFile()) {
          res.status(404).end();
          return;
        }

        const content = await fs.readFile(filePath);
        const ext = path.extname(filePath).toLowerCase();
        
        let cacheType = 'static';
        if (ext === '.html') cacheType = 'dynamic';
        if (ext === '.json') cacheType = 'api';

        const shouldSendContent = res.setCacheHeaders(cacheType, content, {
          lastModified: stats.mtime
        });

        if (shouldSendContent) {
          res.setHeader('Content-Type', this.getMimeType(ext));
          res.end(content);
        }
      } catch (error) {
        res.status(404).end();
      }
    };
  }

  getMimeType(ext) {
    const mimeTypes = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css',
      '.js': 'application/javascript',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.webp': 'image/webp'
    };
    
    return mimeTypes[ext] || 'application/octet-stream';
  }
}
