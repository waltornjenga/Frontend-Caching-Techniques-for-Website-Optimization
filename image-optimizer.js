class IntelligentImageCache {
  constructor(options = {}) {
    this.cache = caches.open('images-v3');
    this.placeholderCache = new Map();
    this.intersectionObserver = new IntersectionObserver(this.handleIntersection.bind(this), {
      rootMargin: '50px 0px',
      threshold: 0.01
    });
    
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
          format,
          size: await this.getImageSize(optimizedUrl)
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

  lazyLoadImage(imgElement, options = {}) {
    const src = imgElement.dataset.src || imgElement.src;
    
    if (!this.config.lazyLoad) {
      this.loadImage(imgElement, src, options);
      return;
    }

    this.setPlaceholder(imgElement, options);
    
    this.intersectionObserver.observe(imgElement);
    
    imgElement._loadCallback = () => this.loadImage(imgElement, src, options);
  }

  async setPlaceholder(imgElement, options) {
    if (options.blurhash) {
      const placeholder = await this.decodeBlurhash(options.blurhash, 32, 32);
      imgElement.style.backgroundImage = `url(${placeholder})`;
      imgElement.style.backgroundSize = 'cover';
      imgElement.classList.add('lqip-loading');
    } else {
      imgElement.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgZmlsbD0iI2Y0ZjRmNCIvPjwvc3ZnPg==';
    }
  }

  async handleIntersection(entries) {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        const img = entry.target;
        this.intersectionObserver.unobserve(img);
        
        if (img._loadCallback) {
          img._loadCallback();
        }
      }
    }
  }

  async loadImage(imgElement, src, options) {
    try {
      const optimizedUrl = await this.optimizeImage(src, options);
      
      const img = new Image();
      img.onload = () => {
        this.applyFinalImage(imgElement, optimizedUrl);
        this.prefetchRelated(src, options);
      };
      img.onerror = () => {
        console.warn('Failed to load optimized image, falling back to original');
        this.applyFinalImage(imgElement, src);
      };
      img.src = optimizedUrl;
    } catch (error) {
      console.error('Image optimization failed:', error);
      this.applyFinalImage(imgElement, src);
    }
  }

  applyFinalImage(imgElement, src) {
    imgElement.src = src;
    imgElement.classList.remove('lqip-loading');
    imgElement.classList.add('lqip-loaded');
    
    imgElement.style.backgroundImage = '';
  }

  prefetchRelated(currentSrc, options) {
    const relatedImages = this.findRelatedImages(currentSrc);
    
    relatedImages.forEach(src => {
      this.optimizeImage(src, options).catch(() => {});
    });
  }

  findRelatedImages(src) {
    return [];
  }

  async decodeBlurhash(hash, width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#f4f4f4';
    ctx.fillRect(0, 0, width, height);
    
    return canvas.toDataURL();
  }

  async preloadCriticalImages(selectors = ['img[loading="eager"]']) {
    const criticalImages = Array.from(document.querySelectorAll(selectors.join(',')));
    
    const preloadPromises = criticalImages.map(async img => {
      const src = img.src || img.dataset.src;
      if (src) {
        try {
          const optimized = await this.optimizeImage(src);
          return this.preloadImage(optimized);
        } catch (error) {
          return this.preloadImage(src);
        }
      }
    });
    
    await Promise.all(preloadPromises);
  }

  async preloadImage(src) {
    return new Promise((resolve, reject) => {
      const link = document.createElement('link');
      link.rel = 'preload';
      link.as = 'image';
      link.href = src;
      link.onload = resolve;
      link.onerror = reject;
      document.head.appendChild(link);
    });
  }

  async getImageSize(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        resolve({ width: img.width, height: img.height });
      };
      img.onerror = () => resolve({ width: 0, height: 0 });
      img.src = src;
    });
  }
}

const imageStyles = `
.lqip-loading {
  filter: blur(20px);
  transform: scale(1.1);
  transition: filter 0.5s ease-out, transform 0.5s ease-out;
}

.lqip-loaded {
  filter: blur(0);
  transform: scale(1);
}

.image-fade-in {
  opacity: 0;
  transition: opacity 0.3s ease-in;
}

.image-fade-in.loaded {
  opacity: 1;
}

.aspect-ratio-box {
  position: relative;
  height: 0;
  overflow: hidden;
}

.aspect-ratio-box img {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
`;

const styleSheet = document.createElement('style');
styleSheet.textContent = imageStyles;
document.head.appendChild(styleSheet);
