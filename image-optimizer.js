class IntelligentImageCache {
  constructor(options = {}) {
    this.cache = caches.open('images-v1');
    this.placeholderCache = new Map();
    
    this.config = {
      quality: options.quality || 80,
      formats: ['webp', 'avif', 'jpeg', 'png'],
      maxWidth: options.maxWidth || 1920,
      lazyLoad: options.lazyLoad !== false
    };
  }

  async optimizeImage(src, options = {}) {
    const cacheKey = this.generateImageKey(src, options);
    const cached = await this.getCachedImage(cacheKey);
    
    if (cached) {
      return cached;
    }

    const imageSet = await this.createResponsiveSet(src, options);
    return imageSet[0].url;
  }

  async createResponsiveSet(src, options) {
    const sizes = options.sizes || [400, 800, 1200, 1920];
    const formats = options.formats || this.config.formats;
    
    const set = [];
    
    for (const size of sizes) {
      for (const format of formats) {
        const optimizedUrl = await this.generateOptimizedUrl(src, {
          width: size,
          format,
          quality: this.config.quality
        });
        
        set.push({
          url: optimizedUrl,
          width: size,
          format
        });
      }
    }
    
    return set.sort((a, b) => a.width - b.width);
  }

  async generateOptimizedUrl(src, options) {
    const params = new URLSearchParams();
    
    if (options.width) params.append('w', options.width);
    if (options.quality) params.append('q', options.quality);
    if (options.format) params.append('fm', options.format);
    
    return `${src}?${params.toString()}`;
  }

  generateImageKey(src, options) {
    const keyData = {
      src,
      width: options.width,
      quality: options.quality,
      format: options.format
    };
    
    return btoa(JSON.stringify(keyData)).replace(/[^a-z0-9]/gi, '');
  }
}
