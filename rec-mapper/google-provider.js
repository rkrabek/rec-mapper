/**
 * Google Map Provider - Google Maps implementation
 */

class GoogleMapProvider extends MapProvider {
  constructor(container, apiKey) {
    super(container);
    this.apiKey = apiKey;
    this.infoWindow = null;
  }

  /**
   * Load Google Maps API
   */
  async loadGoogleMaps() {
    if (window.google && window.google.maps) {
      return;
    }

    return new Promise((resolve, reject) => {
      // Create callback name
      const callbackName = 'googleMapsCallback_' + Date.now();

      window[callbackName] = () => {
        delete window[callbackName];
        resolve();
      };

      const script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?key=${this.apiKey}&callback=${callbackName}`;
      script.async = true;
      script.defer = true;

      script.onerror = () => {
        delete window[callbackName];
        reject(new Error('Failed to load Google Maps API'));
      };

      document.head.appendChild(script);
    });
  }

  /**
   * Initialize the map
   */
  async init() {
    if (!this.apiKey) {
      throw new Error('Google Maps API key is required');
    }

    await this.loadGoogleMaps();

    // Create map centered on US by default
    this.map = new google.maps.Map(this.container, {
      center: { lat: 39.8283, lng: -98.5795 },
      zoom: 4,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false
    });

    // Create a single info window to reuse
    this.infoWindow = new google.maps.InfoWindow();

    return this;
  }

  /**
   * Add a marker to the map
   */
  addMarker(lat, lng, title, options = {}) {
    const markerOptions = {
      position: { lat, lng },
      map: this.map,
      title: title
    };

    // Add label if provided
    if (options.label) {
      markerOptions.label = {
        text: String(options.label),
        color: 'white',
        fontWeight: 'bold',
        fontSize: '12px'
      };
    }

    const marker = new google.maps.Marker(markerOptions);

    // Create info window content
    let content = `<div style="max-width: 250px; font-family: sans-serif; font-size: 13px;">`;
    content += `<strong>${this.escapeHtml(options.formattedAddress || title)}</strong>`;

    if (options.originalAddress && options.originalAddress !== options.formattedAddress) {
      content += `<div style="margin-top: 6px; font-size: 11px; color: #666;">`;
      content += `<em>Original: ${this.escapeHtml(options.originalAddress)}</em></div>`;
    }

    if (options.matchQuality) {
      const color = options.matchQuality === 'Exact match' ? '#059669' : '#b45309';
      content += `<div style="margin-top: 4px; font-size: 10px; color: ${color};">${options.matchQuality}</div>`;
    }

    content += `</div>`;

    // Click handler to show info window
    marker.addListener('click', () => {
      this.infoWindow.setContent(content);
      this.infoWindow.open(this.map, marker);
    });

    this.markers.push(marker);
    return marker;
  }

  /**
   * Set the map center
   */
  setCenter(lat, lng, zoom = 12) {
    this.map.setCenter({ lat, lng });
    this.map.setZoom(zoom);
  }

  /**
   * Fit the map bounds to show all markers
   */
  fitBounds() {
    if (this.markers.length === 0) return;

    if (this.markers.length === 1) {
      const pos = this.markers[0].getPosition();
      this.map.setCenter(pos);
      this.map.setZoom(15);
      return;
    }

    const bounds = new google.maps.LatLngBounds();
    this.markers.forEach(marker => {
      bounds.extend(marker.getPosition());
    });
    this.map.fitBounds(bounds);
  }

  /**
   * Clear all markers from the map
   */
  clearMarkers() {
    this.markers.forEach(marker => {
      marker.setMap(null);
    });
    this.markers = [];

    if (this.infoWindow) {
      this.infoWindow.close();
    }
  }

  /**
   * Escape HTML for info window content
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
    if (this.infoWindow) {
      this.infoWindow.close();
      this.infoWindow = null;
    }
  }
}

// Make available globally
if (typeof window !== 'undefined') {
  window.GoogleMapProvider = GoogleMapProvider;
}
