/**
 * Leaflet Map Provider - OpenStreetMap implementation
 */

class LeafletMapProvider extends MapProvider {
  constructor(container) {
    super(container);
    this.leafletLoaded = false;
  }

  /**
   * Load Leaflet library from CDN
   */
  async loadLeaflet() {
    if (this.leafletLoaded || window.L) {
      this.leafletLoaded = true;
      return;
    }

    return new Promise((resolve, reject) => {
      // Load CSS
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      css.integrity = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';
      css.crossOrigin = '';
      document.head.appendChild(css);

      // Load JS
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.integrity = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';
      script.crossOrigin = '';

      script.onload = () => {
        this.leafletLoaded = true;
        resolve();
      };

      script.onerror = () => {
        reject(new Error('Failed to load Leaflet library'));
      };

      document.head.appendChild(script);
    });
  }

  /**
   * Initialize the map
   */
  async init() {
    await this.loadLeaflet();

    // Create map centered on US by default
    this.map = L.map(this.container, {
      zoomControl: true,
      attributionControl: true
    }).setView([39.8283, -98.5795], 4);

    // Add OpenStreetMap tiles
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(this.map);

    return this;
  }

  /**
   * Create a numbered icon for markers
   */
  createNumberedIcon(number) {
    return L.divIcon({
      className: 'leaflet-numbered-marker',
      html: `<div class="marker-number">${number}</div>`,
      iconSize: [30, 30],
      iconAnchor: [15, 30],
      popupAnchor: [0, -30]
    });
  }

  /**
   * Add a marker to the map
   */
  addMarker(lat, lng, title, options = {}) {
    const markerOptions = {};

    // Use numbered icon if label provided
    if (options.label) {
      markerOptions.icon = this.createNumberedIcon(options.label);
    }

    const marker = L.marker([lat, lng], markerOptions).addTo(this.map);

    // Create popup content
    let popupContent = `<div class="leaflet-popup-content-inner">`;
    popupContent += `<strong>${this.escapeHtml(options.formattedAddress || title)}</strong>`;

    if (options.originalAddress && options.originalAddress !== options.formattedAddress) {
      popupContent += `<div class="popup-original">Original: ${this.escapeHtml(options.originalAddress)}</div>`;
    }

    if (options.matchQuality) {
      const qualityClass = options.matchQuality === 'Exact match' ? 'quality-good' : 'quality-approx';
      popupContent += `<div class="popup-quality ${qualityClass}">${options.matchQuality}</div>`;
    }

    popupContent += `</div>`;

    marker.bindPopup(popupContent, {
      maxWidth: 250
    });

    if (title) {
      marker.bindTooltip(title);
    }

    this.markers.push(marker);
    return marker;
  }

  /**
   * Set the map center
   */
  setCenter(lat, lng, zoom = 12) {
    this.map.setView([lat, lng], zoom);
  }

  /**
   * Fit the map bounds to show all markers
   */
  fitBounds() {
    if (this.markers.length === 0) return;

    if (this.markers.length === 1) {
      const latlng = this.markers[0].getLatLng();
      this.map.setView(latlng, 15);
      return;
    }

    const group = L.featureGroup(this.markers);
    this.map.fitBounds(group.getBounds().pad(0.1));
  }

  /**
   * Clear all markers from the map
   */
  clearMarkers() {
    this.markers.forEach(marker => {
      this.map.removeLayer(marker);
    });
    this.markers = [];
  }

  /**
   * Escape HTML for popup content
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Clean up
   */
  destroy() {
    super.destroy();
    if (this.map) {
      this.map.remove();
    }
  }
}

// Make available globally
if (typeof window !== 'undefined') {
  window.LeafletMapProvider = LeafletMapProvider;
}
