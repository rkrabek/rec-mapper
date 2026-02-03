/**
 * Address Parser - Simple text extraction from DOM elements
 * We let Google Maps handle the actual address parsing/matching
 */

const AddressParser = {
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
   * Get the best text content from an element
   * Tries to find address-like content first, falls back to full text
   */
  getBestAddress(element) {
    const fullText = this.extractText(element);

    if (!fullText || fullText.length < 3) {
      return null;
    }

    // If the text is reasonable length, just use it
    if (fullText.length <= 200) {
      return {
        address: fullText,
        confidence: 'pending', // Will be determined by Google's response
        original: fullText
      };
    }

    // For longer text, try to find a shorter segment that might be an address
    // Look for common patterns but don't validate - just truncate intelligently
    const segments = fullText.split(/[|•·—–]|\s{3,}/);

    // Find the shortest reasonable segment (likely the address part)
    const candidates = segments
      .map(s => s.trim())
      .filter(s => s.length >= 10 && s.length <= 150);

    if (candidates.length > 0) {
      // Prefer segments with numbers (likely street addresses)
      const withNumbers = candidates.filter(c => /\d/.test(c));
      const best = withNumbers[0] || candidates[0];

      return {
        address: best,
        confidence: 'pending',
        original: fullText
      };
    }

    // Just truncate the full text
    return {
      address: fullText.slice(0, 150) + (fullText.length > 150 ? '...' : ''),
      confidence: 'pending',
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
