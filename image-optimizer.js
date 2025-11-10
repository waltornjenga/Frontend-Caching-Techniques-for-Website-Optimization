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
    await this.cacheImageSet(cacheKey, imageSet);
    
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

  async cacheImageSet(key, imageSet) {
    const cache = await this.cache;
    
    for (const image of imageSet) {
      try {
        const response = await fetch(image.url);
        if (response.ok) {
          await cache.put(new Request(image.url), response.clone());
        }
      } catch (error) {
        console.warn(`Failed to cache image: ${image.url}`, error);
      }
    }
    
    const metadata = {
      imageSet,
      cachedAt: Date.now(),
      accessCount: 0
    };
    
    localStorage.setItem(`img_${key}`, JSON.stringify(metadata));
  }

  async getCachedImage(key) {
    const metadataStr = localStorage.getItem(`img_${key}`);
    if (!metadataStr) return null;

    const metadata = JSON.parse(metadataStr);
    metadata.accessCount++;
    localStorage.setItem(`img_${key}`, JSON.stringify(metadata));

    const cache = await this.cache;
    const primaryImage = metadata.imageSet[0];
    const cached = await cache.match(new Request(primaryImage.url));
    
    return cached ? URL.createObjectURL(await cached.blob()) : null;
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
