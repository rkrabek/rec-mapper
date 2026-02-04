/**
 * Map Provider - Abstract interface for map implementations
 */

class MapProvider {
  constructor(container) {
    this.container = container;
    this.map = null;
    this.markers = [];
  }

  /**
   * Initialize the map
   */
  async init() {
    throw new Error('init() must be implemented by subclass');
  }

  /**
   * Add a marker to the map
   * @param {number} lat - Latitude
   * @param {number} lng - Longitude
   * @param {string} title - Marker title
   * @param {object} options - Additional options (label, popupContent, etc.)
   * @returns {object} Marker reference
   */
  addMarker(lat, lng, title, options = {}) {
    throw new Error('addMarker() must be implemented by subclass');
  }

  /**
   * Set the map center
   * @param {number} lat - Latitude
   * @param {number} lng - Longitude
   * @param {number} zoom - Optional zoom level
   */
  setCenter(lat, lng, zoom) {
    throw new Error('setCenter() must be implemented by subclass');
  }

  /**
   * Fit the map bounds to show all markers
   */
  fitBounds() {
    throw new Error('fitBounds() must be implemented by subclass');
  }

  /**
   * Clear all markers from the map
   */
  clearMarkers() {
    throw new Error('clearMarkers() must be implemented by subclass');
  }

  /**
   * Clean up the map instance
   */
  destroy() {
    this.clearMarkers();
    this.map = null;
  }
}

/**
 * Factory to create the appropriate map provider
 */
const MapProviderFactory = {
  /**
   * Create a map provider based on settings
   * @param {string} providerType - 'osm' or 'google'
   * @param {HTMLElement} container - Container element for the map
   * @param {object} options - Provider-specific options (e.g., apiKey for Google)
   */
  async create(providerType, container, options = {}) {
    if (providerType === 'google') {
      const provider = new GoogleMapProvider(container, options.apiKey);
      await provider.init();
      return provider;
    } else {
      const provider = new LeafletMapProvider(container);
      await provider.init();
      return provider;
    }
  }
};

// Make available globally
if (typeof window !== 'undefined') {
  window.MapProvider = MapProvider;
  window.MapProviderFactory = MapProviderFactory;
}
