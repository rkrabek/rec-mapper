/**
 * Pattern Matcher - Finds similar DOM elements based on clicked samples
 */

const PatternMatcher = {
  /**
   * Get the CSS selector path for an element
   */
  getSelectorPath(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return '';

    const path = [];
    let current = element;

    while (current && current.nodeType === Node.ELEMENT_NODE) {
      let selector = current.tagName.toLowerCase();

      // Add ID if present
      if (current.id) {
        selector += '#' + CSS.escape(current.id);
        path.unshift(selector);
        break; // ID is unique, no need to go further
      }

      // Add classes (filter out our own classes)
      const classes = Array.from(current.classList)
        .filter(c => !c.startsWith('rec-mapper-'))
        .map(c => '.' + CSS.escape(c))
        .join('');

      if (classes) {
        selector += classes;
      }

      // Add nth-child for specificity
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(
          c => c.tagName === current.tagName
        );
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          selector += `:nth-of-type(${index})`;
        }
      }

      path.unshift(selector);
      current = current.parentElement;
    }

    return path.join(' > ');
  },

  /**
   * Get element attributes as a fingerprint
   */
  getElementFingerprint(element) {
    return {
      tag: element.tagName.toLowerCase(),
      classes: Array.from(element.classList).filter(c => !c.startsWith('rec-mapper-')),
      hasId: !!element.id,
      childCount: element.children.length,
      textLength: (element.textContent || '').trim().length,
      attributes: Array.from(element.attributes)
        .filter(a => !a.name.startsWith('data-rec-mapper'))
        .map(a => a.name)
    };
  },

  /**
   * Calculate similarity score between two elements (0-1)
   */
  calculateSimilarity(elem1, elem2) {
    const fp1 = this.getElementFingerprint(elem1);
    const fp2 = this.getElementFingerprint(elem2);

    let score = 0;
    let factors = 0;

    // Same tag name is essential
    if (fp1.tag === fp2.tag) {
      score += 2;
    } else {
      return 0; // Different tags = not similar
    }
    factors += 2;

    // Class overlap
    const commonClasses = fp1.classes.filter(c => fp2.classes.includes(c));
    const allClasses = new Set([...fp1.classes, ...fp2.classes]);
    if (allClasses.size > 0) {
      score += (commonClasses.length / allClasses.size) * 2;
      factors += 2;
    }

    // Similar child count
    const childDiff = Math.abs(fp1.childCount - fp2.childCount);
    const maxChildren = Math.max(fp1.childCount, fp2.childCount, 1);
    score += (1 - childDiff / maxChildren);
    factors += 1;

    // Similar text length (within 50%)
    const textDiff = Math.abs(fp1.textLength - fp2.textLength);
    const maxText = Math.max(fp1.textLength, fp2.textLength, 1);
    if (textDiff / maxText < 0.5) {
      score += 0.5;
    }
    factors += 0.5;

    // Similar attributes
    const commonAttrs = fp1.attributes.filter(a => fp2.attributes.includes(a));
    const allAttrs = new Set([...fp1.attributes, ...fp2.attributes]);
    if (allAttrs.size > 0) {
      score += (commonAttrs.length / allAttrs.size);
      factors += 1;
    }

    return score / factors;
  },

  /**
   * Find the common parent of multiple elements
   */
  findCommonParent(elements) {
    if (!elements || elements.length === 0) return null;
    if (elements.length === 1) return elements[0].parentElement;

    // Get all ancestors for the first element
    const getAncestors = (el) => {
      const ancestors = [];
      let current = el.parentElement;
      while (current) {
        ancestors.push(current);
        current = current.parentElement;
      }
      return ancestors;
    };

    const firstAncestors = getAncestors(elements[0]);

    // Find the first common ancestor
    for (const ancestor of firstAncestors) {
      if (elements.every(el => ancestor.contains(el))) {
        return ancestor;
      }
    }

    return document.body;
  },

  /**
   * Find the most specific common selector pattern
   */
  findCommonSelector(elements) {
    if (!elements || elements.length < 2) return null;

    // Get fingerprints for all elements
    const fingerprints = elements.map(el => this.getElementFingerprint(el));

    // Find common tag
    const commonTag = fingerprints[0].tag;
    if (!fingerprints.every(fp => fp.tag === commonTag)) {
      return null; // No common tag
    }

    // Find common classes
    let commonClasses = fingerprints[0].classes;
    for (let i = 1; i < fingerprints.length; i++) {
      commonClasses = commonClasses.filter(c => fingerprints[i].classes.includes(c));
    }

    // Build selector
    let selector = commonTag;
    if (commonClasses.length > 0) {
      // Use the most specific classes (usually the ones with meaningful names)
      const prioritizedClasses = commonClasses
        .filter(c => c.length > 2 && !/^[a-z]{1,2}$/.test(c)) // Filter out single-letter classes
        .sort((a, b) => b.length - a.length)
        .slice(0, 3);

      if (prioritizedClasses.length > 0) {
        selector += prioritizedClasses.map(c => '.' + CSS.escape(c)).join('');
      }
    }

    return selector;
  },

  /**
   * Find the parent-relative selector pattern
   */
  findParentRelativePattern(elements) {
    if (!elements || elements.length < 2) return null;

    const commonParent = this.findCommonParent(elements);
    if (!commonParent) return null;

    // Get relative paths from common parent
    const getRelativePath = (element, parent) => {
      const path = [];
      let current = element;

      while (current && current !== parent) {
        const fp = this.getElementFingerprint(current);
        path.unshift({
          tag: fp.tag,
          classes: fp.classes
        });
        current = current.parentElement;
      }

      return path;
    };

    const paths = elements.map(el => getRelativePath(el, commonParent));

    // Find common path structure
    const minLength = Math.min(...paths.map(p => p.length));
    const commonPath = [];

    for (let i = 0; i < minLength; i++) {
      // Get all tags at this level
      const tags = paths.map(p => p[i].tag);
      if (new Set(tags).size !== 1) break;

      // Get common classes at this level
      let commonClasses = paths[0][i].classes;
      for (let j = 1; j < paths.length; j++) {
        commonClasses = commonClasses.filter(c => paths[j][i].classes.includes(c));
      }

      commonPath.push({
        tag: tags[0],
        classes: commonClasses
      });
    }

    if (commonPath.length === 0) return null;

    // Build selector from common path
    const parentSelector = this.getSelectorPath(commonParent);
    const childSelector = commonPath
      .map(p => {
        let sel = p.tag;
        if (p.classes.length > 0) {
          const validClasses = p.classes
            .filter(c => c.length > 2)
            .slice(0, 2);
          if (validClasses.length > 0) {
            sel += validClasses.map(c => '.' + CSS.escape(c)).join('');
          }
        }
        return sel;
      })
      .join(' > ');

    return {
      parent: commonParent,
      parentSelector,
      childSelector,
      fullSelector: parentSelector + ' ' + childSelector
    };
  },

  /**
   * Find all matching elements based on clicked samples
   */
  findMatches(sampleElements, options = {}) {
    const { minSimilarity = 0.6, searchRoot = document.body } = options;

    if (!sampleElements || sampleElements.length < 2) {
      return { matches: [], selector: null, confidence: 'low' };
    }

    // Strategy 1: Try common CSS selector
    const commonSelector = this.findCommonSelector(sampleElements);
    if (commonSelector) {
      try {
        const candidates = Array.from(searchRoot.querySelectorAll(commonSelector));
        const matches = candidates.filter(candidate => {
          // Must be similar to at least one sample
          return sampleElements.some(
            sample => this.calculateSimilarity(sample, candidate) >= minSimilarity
          );
        });

        if (matches.length >= sampleElements.length) {
          return {
            matches,
            selector: commonSelector,
            confidence: matches.length <= sampleElements.length * 3 ? 'high' : 'medium'
          };
        }
      } catch (e) {
        console.warn('Selector query failed:', commonSelector, e);
      }
    }

    // Strategy 2: Try parent-relative pattern
    const pattern = this.findParentRelativePattern(sampleElements);
    if (pattern && pattern.fullSelector) {
      try {
        const candidates = Array.from(document.querySelectorAll(pattern.fullSelector));
        const matches = candidates.filter(candidate => {
          return sampleElements.some(
            sample => this.calculateSimilarity(sample, candidate) >= minSimilarity
          );
        });

        if (matches.length >= sampleElements.length) {
          return {
            matches,
            selector: pattern.fullSelector,
            confidence: matches.length <= sampleElements.length * 3 ? 'high' : 'medium'
          };
        }
      } catch (e) {
        console.warn('Pattern query failed:', pattern.fullSelector, e);
      }
    }

    // Strategy 3: Similarity-based search within common parent
    const commonParent = this.findCommonParent(sampleElements);
    if (commonParent) {
      const tagName = sampleElements[0].tagName.toLowerCase();
      const candidates = Array.from(commonParent.querySelectorAll(tagName));

      const matches = candidates.filter(candidate => {
        const avgSimilarity = sampleElements.reduce(
          (sum, sample) => sum + this.calculateSimilarity(sample, candidate),
          0
        ) / sampleElements.length;
        return avgSimilarity >= minSimilarity;
      });

      if (matches.length >= sampleElements.length) {
        return {
          matches,
          selector: `${this.getSelectorPath(commonParent)} ${tagName}`,
          confidence: 'medium'
        };
      }
    }

    // Strategy 4: Brute force search all similar elements
    const tagName = sampleElements[0].tagName.toLowerCase();
    const allElements = Array.from(document.getElementsByTagName(tagName));

    const matches = allElements.filter(candidate => {
      const avgSimilarity = sampleElements.reduce(
        (sum, sample) => sum + this.calculateSimilarity(sample, candidate),
        0
      ) / sampleElements.length;
      return avgSimilarity >= minSimilarity * 0.8; // Lower threshold for fallback
    });

    return {
      matches,
      selector: tagName,
      confidence: 'low'
    };
  },

  /**
   * Refine matches by excluding specific elements
   */
  refineMatches(currentMatches, excludedElements) {
    return currentMatches.filter(el => !excludedElements.includes(el));
  }
};

// Make available to content script
if (typeof window !== 'undefined') {
  window.PatternMatcher = PatternMatcher;
}
