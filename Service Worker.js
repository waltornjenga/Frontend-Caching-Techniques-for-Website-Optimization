
class AdvancedServiceWorker {
  constructor() {
    this.version = 'v2.1.0';
    this.init();
  }

  init() {
    self.addEventListener('install', this.handleInstall.bind(this));
    self.addEventListener('activate', this.handleActivate.bind(this));
  }
}


new AdvancedServiceWorker();
