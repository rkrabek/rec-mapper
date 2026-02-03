/**
 * Address Parser - Text extraction and Google Maps link detection
 * We let Google Maps handle the actual address parsing/matching
 */

const AddressParser = {
  // Google Maps URL patterns
  googleMapsPatterns: [
    // maps.google.com/maps/place/Place+Name
    /maps\.google\.com\/maps\/place\/([^\/\?]+)/i,
    // google.com/maps/place/Place+Name
    /google\.com\/maps\/place\/([^\/\?]+)/i,
    // goo.gl/maps/xxxxx (short URL - we'll use the link text)
    /goo\.gl\/maps\//i,
    // maps.app.goo.gl/xxxxx (mobile share links)
    /maps\.app\.goo\.gl\//i,
    // google.com/maps?q=query
    /google\.com\/maps\?.*q=([^&]+)/i,
    // google.com/maps/search/query
    /google\.com\/maps\/search\/([^\/\?]+)/i
  ],

  /**
   * Check if a URL is a Google Maps link
   */
  isGoogleMapsUrl(url) {
    if (!url) return false;
    return this.googleMapsPatterns.some(pattern => pattern.test(url));
  },

  /**
   * Extract place name from Google Maps URL
   */
  extractFromGoogleMapsUrl(url) {
    if (!url) return null;

    // Try each pattern
    for (const pattern of this.googleMapsPatterns) {
      const match = url.match(pattern);
      if (match && match[1]) {
        // Decode URL-encoded characters and replace + with spaces
        let placeName = decodeURIComponent(match[1].replace(/\+/g, ' '));
        // Clean up common URL artifacts
        placeName = placeName.replace(/@.*$/, '').trim();
        if (placeName.length > 2) {
          return placeName;
        }
      }
    }

    return null;
  },

  /**
   * Extract clean text from an element, stripping HTML
   */
  extractText(element) {
    if (!element) return '';

    // Clone to avoid modifying original
    const clone = element.cloneNode(true);

    // Remove script and style elements
    clone.querySelectorAll('script, style, noscript, svg, img').forEach(el => el.remove());

    // Get text content and normalize whitespace
    let text = clone.textContent || clone.innerText || '';

    // Normalize whitespace but preserve some structure
    text = text
      .replace(/[\t\r]+/g, ' ')
      .replace(/\n+/g, ', ')
      .replace(/\s+/g, ' ')
      .replace(/,\s*,/g, ',')
      .replace(/,\s*$/g, '')
      .trim();

    return text;
  },

  /**
   * Check if an element contains a Google Maps link
   */
  findGoogleMapsLink(element) {
    if (!element) return null;

    // Check if element itself is a link
    if (element.tagName === 'A' && element.href) {
      if (this.isGoogleMapsUrl(element.href)) {
        return {
          url: element.href,
          text: element.textContent?.trim() || ''
        };
      }
    }

    // Check child links
    const links = element.querySelectorAll('a[href]');
    for (const link of links) {
      if (this.isGoogleMapsUrl(link.href)) {
        return {
          url: link.href,
          text: link.textContent?.trim() || ''
        };
      }
    }

    return null;
  },

  /**
   * Get the best text content from an element
   * Prioritizes Google Maps links, then falls back to text extraction
   */
  getBestAddress(element) {
    // First check for Google Maps links
    const mapsLink = this.findGoogleMapsLink(element);
    if (mapsLink) {
      // Try to extract place name from URL
      const fromUrl = this.extractFromGoogleMapsUrl(mapsLink.url);
      if (fromUrl) {
        return {
          address: fromUrl,
          type: 'google-maps-link',
          url: mapsLink.url,
          original: mapsLink.text || fromUrl
        };
      }
      // Fall back to link text if we can't parse the URL
      if (mapsLink.text && mapsLink.text.length > 2) {
        return {
          address: mapsLink.text,
          type: 'google-maps-link',
          url: mapsLink.url,
          original: mapsLink.text
        };
      }
    }

    // Extract text content
    const fullText = this.extractText(element);

    if (!fullText || fullText.length < 3) {
      return null;
    }

    // If the text is reasonable length, just use it
    if (fullText.length <= 200) {
      return {
        address: fullText,
        type: 'text',
        original: fullText
      };
    }

    // For longer text, try to find a shorter segment that might be an address
    const segments = fullText.split(/[|•·—–]|\s{3,}/);

    // Find the shortest reasonable segment (likely the address part)
    const candidates = segments
      .map(s => s.trim())
      .filter(s => s.length >= 5 && s.length <= 150);

    if (candidates.length > 0) {
      // Prefer segments with numbers (likely street addresses)
      const withNumbers = candidates.filter(c => /\d/.test(c));
      const best = withNumbers[0] || candidates[0];

      return {
        address: best,
        type: 'text',
        original: fullText
      };
    }

    // Just truncate the full text
    return {
      address: fullText.slice(0, 150) + (fullText.length > 150 ? '...' : ''),
      type: 'text',
      original: fullText
    };
  },

  /**
   * Clean and normalize text for display
   */
  normalize(text) {
    if (!text) return '';
    return text
      .replace(/\s+/g, ' ')
      .replace(/,\s*,/g, ',')
      .replace(/\s+,/g, ',')
      .replace(/,([^\s])/g, ', $1')
      .trim();
  }
};

// Make available to content script
if (typeof window !== 'undefined') {
  window.AddressParser = AddressParser;
}
