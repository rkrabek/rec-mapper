/**
 * Geocoder - Unified geocoding with caching and provider abstraction
 */

const Geocoder = {
  // Rate limiting for Nominatim (1 request per second)
  lastNominatimRequest: 0,
  nominatimDelay: 1100, // 1.1 seconds to be safe

  /**
   * Generate a cache key for an address
   */
  getCacheKey(address, provider) {
    // Simple hash function for cache key
    const hash = address.toLowerCase().replace(/\s+/g, '_').substring(0, 100);
    return `geocode_${provider}_${hash}`;
  },

  /**
   * Check cache for a geocoded result
   */
  async checkCache(address, provider) {
    const cacheKey = this.getCacheKey(address, provider);
    const cached = await chrome.storage.local.get(cacheKey);
    return cached[cacheKey] || null;
  },

  /**
   * Save result to cache
   */
  async saveToCache(address, provider, result) {
    const cacheKey = this.getCacheKey(address, provider);
    await chrome.storage.local.set({ [cacheKey]: result });
  },

  /**
   * Geocode using Nominatim (OpenStreetMap)
   */
  async geocodeWithNominatim(address) {
    // Check cache first
    const cached = await this.checkCache(address, 'osm');
    if (cached) {
      return { ...cached, fromCache: true };
    }

    // Rate limiting
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastNominatimRequest;
    if (timeSinceLastRequest < this.nominatimDelay) {
      await new Promise(r => setTimeout(r, this.nominatimDelay - timeSinceLastRequest));
    }
    this.lastNominatimRequest = Date.now();

    const encodedAddress = encodeURIComponent(address);
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodedAddress}&limit=5&addressdetails=1`;

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'RecMapper/1.0 (Chrome Extension for address mapping)'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      if (data && data.length > 0) {
        const result = {
          success: true,
          lat: parseFloat(data[0].lat),
          lng: parseFloat(data[0].lon),
          formattedAddress: data[0].display_name,
          placeId: data[0].place_id,
          type: data[0].type,
          // Include all results for disambiguation if needed
          allResults: data.map(r => ({
            lat: parseFloat(r.lat),
            lng: parseFloat(r.lon),
            formattedAddress: r.display_name,
            placeId: r.place_id,
            type: r.type
          })),
          multipleResults: data.length > 1
        };

        // Cache the result
        await this.saveToCache(address, 'osm', result);
        return result;
      } else {
        return { success: false, error: 'No results found', noResults: true };
      }
    } catch (error) {
      return { success: false, error: error.message, networkError: true };
    }
  },

  /**
   * Geocode using Google Maps API
   */
  async geocodeWithGoogle(address, apiKey) {
    if (!apiKey) {
      return { success: false, error: 'API key required' };
    }

    // Check cache first
    const cached = await this.checkCache(address, 'google');
    if (cached) {
      return { ...cached, fromCache: true };
    }

    const encodedAddress = encodeURIComponent(address);
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodedAddress}&key=${apiKey}`;

    try {
      const response = await fetch(url);
      const data = await response.json();

      if (data.status === 'OK' && data.results.length > 0) {
        const firstResult = data.results[0];
        const result = {
          success: true,
          lat: firstResult.geometry.location.lat,
          lng: firstResult.geometry.location.lng,
          formattedAddress: firstResult.formatted_address,
          placeId: firstResult.place_id,
          locationType: firstResult.geometry.location_type,
          partialMatch: firstResult.partial_match || false,
          types: firstResult.types,
          // Include all results for disambiguation
          allResults: data.results.map(r => ({
            lat: r.geometry.location.lat,
            lng: r.geometry.location.lng,
            formattedAddress: r.formatted_address,
            placeId: r.place_id,
            locationType: r.geometry.location_type
          })),
          multipleResults: data.results.length > 1
        };

        // Cache the result
        await this.saveToCache(address, 'google', result);
        return result;
      } else if (data.status === 'ZERO_RESULTS') {
        return { success: false, error: 'No results found', noResults: true };
      } else if (data.status === 'OVER_QUERY_LIMIT') {
        return { success: false, error: 'API rate limit exceeded', retryable: true };
      } else if (data.status === 'REQUEST_DENIED') {
        return { success: false, error: 'Invalid API key', invalidKey: true };
      } else {
        return { success: false, error: data.status || 'Unknown error' };
      }
    } catch (error) {
      return { success: false, error: error.message, networkError: true };
    }
  },

  /**
   * Geocode an address using the specified provider
   */
  async geocode(address, provider, apiKey) {
    if (provider === 'google') {
      return this.geocodeWithGoogle(address, apiKey);
    } else {
      return this.geocodeWithNominatim(address);
    }
  },

  /**
   * Batch geocode with progress callback
   */
  async geocodeBatch(addresses, provider, apiKey, onProgress) {
    const results = [];

    for (let i = 0; i < addresses.length; i++) {
      if (onProgress) {
        onProgress(i + 1, addresses.length, addresses[i].address);
      }

      const result = await this.geocode(addresses[i].address, provider, apiKey);

      results.push({
        ...addresses[i],
        geocode: result
      });

      // Small additional delay for Google to avoid rate limits
      if (provider === 'google' && i < addresses.length - 1 && !result.fromCache) {
        await new Promise(r => setTimeout(r, 100));
      }
    }

    return results;
  },

  /**
   * Clear geocode cache
   */
  async clearCache(provider) {
    const items = await chrome.storage.local.get();
    const prefix = provider ? `geocode_${provider}_` : 'geocode_';
    const keysToRemove = Object.keys(items).filter(k => k.startsWith(prefix));

    if (keysToRemove.length > 0) {
      await chrome.storage.local.remove(keysToRemove);
    }

    return keysToRemove.length;
  }
};

// Make available globally
if (typeof window !== 'undefined') {
  window.Geocoder = Geocoder;
}
