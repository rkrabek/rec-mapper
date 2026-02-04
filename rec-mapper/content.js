/**
 * Content Script - Handles click-based selection and pattern matching
 */

(function() {
  'use strict';

  // State management
  const state = {
    isSelectionMode: false,
    selectedElements: [],
    matchedElements: [],
    excludedElements: [],
    extractedResults: [],
    hoveredElement: null,
    overlay: null,
    banner: null,
    resultsPanel: null
  };

  // Create UI elements
  function createOverlay() {
    const overlay = document.createElement('div');
    overlay.className = 'rec-mapper-overlay';
    document.body.appendChild(overlay);
    return overlay;
  }

  function createBanner() {
    const banner = document.createElement('div');
    banner.className = 'rec-mapper-banner';
    banner.innerHTML = `
      <div class="rec-mapper-banner-text">
        <span>Click on 2-3 similar items containing addresses</span>
        <span class="rec-mapper-banner-counter">0 selected</span>
      </div>
      <div class="rec-mapper-banner-buttons">
        <button class="rec-mapper-btn rec-mapper-btn-done" disabled>Find Matches</button>
        <button class="rec-mapper-btn rec-mapper-btn-cancel">Cancel (ESC)</button>
      </div>
    `;

    // Event listeners
    banner.querySelector('.rec-mapper-btn-done').addEventListener('click', findMatches);
    banner.querySelector('.rec-mapper-btn-cancel').addEventListener('click', cancelSelection);

    document.body.appendChild(banner);
    return banner;
  }

  function updateBanner() {
    if (!state.banner) return;

    const counter = state.banner.querySelector('.rec-mapper-banner-counter');
    const doneBtn = state.banner.querySelector('.rec-mapper-btn-done');

    counter.textContent = `${state.selectedElements.length} selected`;
    doneBtn.disabled = state.selectedElements.length < 2;

    if (state.matchedElements.length > 0) {
      const totalMatches = state.selectedElements.length + state.matchedElements.length;
      const text = state.banner.querySelector('.rec-mapper-banner-text span');
      text.textContent = `${totalMatches} total matches found`;
    }
  }

  function createResultsPanel() {
    // Remove existing panel
    if (state.resultsPanel) {
      state.resultsPanel.remove();
    }

    const panel = document.createElement('div');
    panel.className = 'rec-mapper-results-panel';

    renderResultsPanel(panel);

    document.body.appendChild(panel);
    state.resultsPanel = panel;
  }

  function renderResultsPanel(panel, preserveScroll = false) {
    if (!panel) panel = state.resultsPanel;
    if (!panel) return;

    // Preserve scroll position
    const resultsBody = panel.querySelector('.rec-mapper-results-body');
    const scrollTop = preserveScroll && resultsBody ? resultsBody.scrollTop : 0;

    const results = state.extractedResults;

    const itemsHtml = results.map((r, i) => `
      <div class="rec-mapper-result-item ${r.excluded ? 'excluded' : ''}" data-index="${i}">
        <div class="rec-mapper-result-content">
          <span class="rec-mapper-result-text">${escapeHtml(r.address)}</span>
          <input type="text" class="rec-mapper-result-input" value="${escapeHtml(r.address)}" style="display:none;">
        </div>
        <div class="rec-mapper-result-actions">
          <button class="rec-mapper-result-btn edit-btn" title="Edit">✎</button>
          <button class="rec-mapper-result-btn exclude-btn" title="${r.excluded ? 'Include' : 'Exclude'}">${r.excluded ? '↩' : '✕'}</button>
        </div>
      </div>
    `).join('');

    const includedCount = results.filter(r => !r.excluded).length;

    // Get current search area value if panel already exists
    const existingSearchArea = panel.querySelector('#rec-mapper-search-area');
    const searchAreaValue = existingSearchArea ? existingSearchArea.value : '';

    panel.innerHTML = `
      <div class="rec-mapper-results-header">
        <span>Extracted Locations</span>
        <span class="rec-mapper-results-count">${includedCount} of ${results.length}</span>
      </div>
      <div class="rec-mapper-results-body">
        ${itemsHtml || '<div class="rec-mapper-result-item" style="color: #6b7280; text-align: center;">No results</div>'}
      </div>
      <div class="rec-mapper-search-area">
        <label for="rec-mapper-search-area">Search Area:</label>
        <input type="text" id="rec-mapper-search-area" placeholder="e.g., San Francisco, CA" value="${escapeHtml(searchAreaValue)}">
        <span class="rec-mapper-search-hint">Added to locations for better geocoding</span>
      </div>
      <div class="rec-mapper-results-footer">
        <button class="rec-mapper-btn rec-mapper-btn-cancel" id="rec-mapper-refine">Refine</button>
        <button class="rec-mapper-btn rec-mapper-btn-cancel" id="rec-mapper-save">Save</button>
        <button class="rec-mapper-btn rec-mapper-btn-done" id="rec-mapper-map">Map</button>
      </div>
    `;

    // Restore scroll position
    if (preserveScroll && scrollTop > 0) {
      const newResultsBody = panel.querySelector('.rec-mapper-results-body');
      if (newResultsBody) {
        newResultsBody.scrollTop = scrollTop;
      }
    }

    // Add event listeners to result items
    panel.querySelectorAll('.rec-mapper-result-item').forEach(item => {
      const index = parseInt(item.dataset.index);

      // Edit button
      item.querySelector('.edit-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        const textEl = item.querySelector('.rec-mapper-result-text');
        const inputEl = item.querySelector('.rec-mapper-result-input');
        const editBtn = item.querySelector('.edit-btn');

        if (inputEl.style.display === 'none') {
          // Start editing
          textEl.style.display = 'none';
          inputEl.style.display = 'block';
          inputEl.focus();
          inputEl.select();
          editBtn.textContent = '✓';
        } else {
          // Save
          textEl.style.display = 'block';
          inputEl.style.display = 'none';
          state.extractedResults[index].address = inputEl.value;
          textEl.textContent = inputEl.value;
          editBtn.textContent = '✎';
        }
      });

      // Handle enter key in input
      item.querySelector('.rec-mapper-result-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          item.querySelector('.edit-btn').click();
        } else if (e.key === 'Escape') {
          const textEl = item.querySelector('.rec-mapper-result-text');
          const inputEl = item.querySelector('.rec-mapper-result-input');
          textEl.style.display = 'block';
          inputEl.style.display = 'none';
          inputEl.value = state.extractedResults[index].address;
          item.querySelector('.edit-btn').textContent = '✎';
        }
      });

      // Exclude button
      item.querySelector('.exclude-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        const wasExcluded = state.extractedResults[index].excluded;

        if (!wasExcluded) {
          // Excluding: find and exclude similar items
          excludeWithSimilar(index);
        } else {
          // Re-including: just toggle this one item back
          state.extractedResults[index].excluded = false;
          renderResultsPanel(null, true);
          updateHighlights();
        }
      });
    });

    // Refine pattern button
    panel.querySelector('#rec-mapper-refine').addEventListener('click', refinePattern);

    // Save button - saves for later use
    panel.querySelector('#rec-mapper-save').addEventListener('click', saveForLater);

    // Map button - stores data and opens map in new tab
    panel.querySelector('#rec-mapper-map').addEventListener('click', openMapTab);
  }

  function updateHighlights() {
    // Update visual highlighting based on excluded state
    state.extractedResults.forEach((result, index) => {
      if (result.element) {
        const el = findElementByIdentifier(result.element);
        if (el) {
          if (result.excluded) {
            el.classList.remove('rec-mapper-match', 'rec-mapper-selected');
            el.classList.add('rec-mapper-excluded');
          } else {
            el.classList.remove('rec-mapper-excluded');
            if (state.selectedElements.includes(el)) {
              el.classList.add('rec-mapper-selected');
            } else {
              el.classList.add('rec-mapper-match');
            }
          }
        }
      }
    });
  }

  function findElementByIdentifier(identifier) {
    if (!identifier || !identifier.path) return null;
    try {
      return document.querySelector(identifier.path);
    } catch (e) {
      return null;
    }
  }

  /**
   * Exclude an item and automatically exclude similar items based on pattern matching
   */
  function excludeWithSimilar(excludedIndex) {
    const excludedResult = state.extractedResults[excludedIndex];
    const excludedElement = findElementByIdentifier(excludedResult.element);

    // Mark the clicked item as excluded
    excludedResult.excluded = true;

    if (!excludedElement) {
      // Can't find element, just exclude this one item
      renderResultsPanel(null, true);
      updateHighlights();
      return;
    }

    // Find similar items to auto-exclude
    const similarityThreshold = 0.75; // High threshold to only exclude very similar items
    let excludedCount = 1;

    state.extractedResults.forEach((result, index) => {
      if (index === excludedIndex || result.excluded) return;

      const resultElement = findElementByIdentifier(result.element);
      if (!resultElement) return;

      // Calculate similarity between the excluded element and this element
      const similarity = PatternMatcher.calculateSimilarity(excludedElement, resultElement);

      if (similarity >= similarityThreshold) {
        // Also check text content similarity for better accuracy
        const textSimilarity = calculateTextSimilarity(excludedResult.address, result.address);

        // Exclude if structurally similar AND text patterns are similar
        // (e.g., both are short names, both are addresses, etc.)
        if (textSimilarity >= 0.3 || similarity >= 0.9) {
          result.excluded = true;
          excludedCount++;
        }
      }
    });

    // Show feedback if multiple items were excluded
    if (excludedCount > 1) {
      showExclusionFeedback(excludedCount);
    }

    renderResultsPanel(null, true);
    updateHighlights();
  }

  /**
   * Calculate text similarity between two strings (0-1)
   * Used to help determine if extracted content is of the same "type"
   */
  function calculateTextSimilarity(text1, text2) {
    if (!text1 || !text2) return 0;

    const t1 = text1.toLowerCase().trim();
    const t2 = text2.toLowerCase().trim();

    // Check length similarity
    const lenRatio = Math.min(t1.length, t2.length) / Math.max(t1.length, t2.length);

    // Check if both have numbers (likely addresses) or both don't
    const hasNumbers1 = /\d/.test(t1);
    const hasNumbers2 = /\d/.test(t2);
    const numberMatch = hasNumbers1 === hasNumbers2 ? 0.3 : 0;

    // Check word count similarity
    const words1 = t1.split(/\s+/).length;
    const words2 = t2.split(/\s+/).length;
    const wordRatio = Math.min(words1, words2) / Math.max(words1, words2);

    // Check for common patterns (URLs, phone numbers, etc.)
    const isUrl1 = /^https?:\/\//.test(t1);
    const isUrl2 = /^https?:\/\//.test(t2);
    const patternMatch = isUrl1 === isUrl2 ? 0.2 : 0;

    return (lenRatio * 0.3) + numberMatch + (wordRatio * 0.2) + patternMatch;
  }

  /**
   * Show brief feedback when multiple items are excluded
   */
  function showExclusionFeedback(count) {
    const feedback = document.createElement('div');
    feedback.className = 'rec-mapper-feedback';
    feedback.textContent = `Excluded ${count} similar items`;
    document.body.appendChild(feedback);

    setTimeout(() => {
      feedback.classList.add('fade-out');
      setTimeout(() => feedback.remove(), 300);
    }, 1500);
  }

  function refinePattern() {
    // Get the non-excluded items
    const includedResults = state.extractedResults.filter(r => !r.excluded);
    const excludedResults = state.extractedResults.filter(r => r.excluded);

    if (includedResults.length < 2) {
      alert('Need at least 2 included items to refine the pattern.');
      return;
    }

    // Find elements for included results
    const includedElements = includedResults
      .map(r => findElementByIdentifier(r.element))
      .filter(el => el !== null);

    if (includedElements.length < 2) {
      alert('Could not find enough elements to refine pattern.');
      return;
    }

    // Clear current matches
    state.matchedElements.forEach(el => {
      el.classList.remove('rec-mapper-match', 'rec-mapper-excluded');
    });
    state.matchedElements = [];
    state.selectedElements = includedElements;

    // Re-run pattern matching with the refined set
    const result = PatternMatcher.findMatches(includedElements, { minSimilarity: 0.7 });

    // Filter out excluded elements from new matches
    const excludedPaths = new Set(excludedResults.map(r => r.element?.path).filter(Boolean));

    result.matches.forEach(element => {
      const path = PatternMatcher.getSelectorPath(element);
      if (!includedElements.includes(element) && !excludedPaths.has(path)) {
        element.classList.add('rec-mapper-match');
        state.matchedElements.push(element);
      }
    });

    // Re-extract addresses
    const allElements = [...includedElements, ...state.matchedElements];
    state.extractedResults = extractAddressesFromElements(allElements);

    // Mark previously excluded items that are still present
    state.extractedResults.forEach(result => {
      if (excludedPaths.has(result.element?.path)) {
        result.excluded = true;
      }
    });

    renderResultsPanel();
    updateBanner();
  }

  function saveForLater() {
    const includedResults = state.extractedResults.filter(r => !r.excluded);

    if (includedResults.length === 0) {
      alert('No locations to save. Please include at least one location.');
      return;
    }

    // Get search area
    const searchAreaInput = state.resultsPanel.querySelector('#rec-mapper-search-area');
    const searchArea = searchAreaInput ? searchAreaInput.value.trim() : '';

    // Prompt for name
    const name = prompt('Enter a name for this extraction:', document.title.substring(0, 30));
    if (!name) return;

    // Save to storage
    chrome.runtime.sendMessage({
      action: 'saveExtraction',
      name: name,
      addresses: includedResults,
      searchArea: searchArea,
      pageUrl: window.location.href,
      pageTitle: document.title
    }, (response) => {
      if (response && response.success) {
        // Show notification
        const notification = document.createElement('div');
        notification.className = 'rec-mapper-notification';
        notification.innerHTML = `<span>✓ Saved "${name}" with ${includedResults.length} locations</span>`;
        document.body.appendChild(notification);
        setTimeout(() => notification.remove(), 3000);
      }
    });
  }

  function openMapTab() {
    // Get included results
    const includedResults = state.extractedResults.filter(r => !r.excluded);

    if (includedResults.length === 0) {
      alert('No locations to map. Please include at least one location.');
      return;
    }

    // Get search area
    const searchAreaInput = state.resultsPanel.querySelector('#rec-mapper-search-area');
    const searchArea = searchAreaInput ? searchAreaInput.value.trim() : '';

    // Send to background to save and open map tab
    chrome.runtime.sendMessage({
      action: 'openMapTab',
      addresses: includedResults,
      searchArea: searchArea,
      pageUrl: window.location.href,
      pageTitle: document.title
    });

    // Show notification and exit
    const notification = document.createElement('div');
    notification.className = 'rec-mapper-notification';
    notification.innerHTML = `
      <span>✓ Opening map with ${includedResults.length} locations...</span>
    `;
    document.body.appendChild(notification);

    setTimeout(() => {
      notification.remove();
    }, 2000);

    // Exit selection mode
    exitSelectionMode(false);
  }

  function finishSelection() {
    // Legacy function - now just calls openMapTab
    openMapTab();
  }

  // Selection mode handlers
  function enterSelectionMode() {
    if (state.isSelectionMode) return;

    state.isSelectionMode = true;
    state.selectedElements = [];
    state.matchedElements = [];
    state.excludedElements = [];
    state.extractedResults = [];

    state.overlay = createOverlay();
    state.banner = createBanner();

    document.addEventListener('mouseover', handleMouseOver, true);
    document.addEventListener('mouseout', handleMouseOut, true);
    document.addEventListener('click', handleClick, true);
    document.addEventListener('keydown', handleKeyDown, true);

    // Add padding to body for banner
    document.body.style.paddingTop = '50px';
  }

  function exitSelectionMode(keepResults = false) {
    state.isSelectionMode = false;

    // Remove event listeners
    document.removeEventListener('mouseover', handleMouseOver, true);
    document.removeEventListener('mouseout', handleMouseOut, true);
    document.removeEventListener('click', handleClick, true);
    document.removeEventListener('keydown', handleKeyDown, true);

    // Clean up UI
    if (state.overlay) {
      state.overlay.remove();
      state.overlay = null;
    }
    if (state.banner) {
      state.banner.remove();
      state.banner = null;
    }
    if (state.resultsPanel) {
      state.resultsPanel.remove();
      state.resultsPanel = null;
    }

    // Remove body padding
    document.body.style.paddingTop = '';

    // Clean up highlights
    if (!keepResults) {
      cleanupHighlights();
    }
  }

  function cancelSelection() {
    exitSelectionMode(false);
    chrome.runtime.sendMessage({ action: 'selectionCancelled' });
  }

  function cleanupHighlights() {
    document.querySelectorAll('.rec-mapper-hover, .rec-mapper-selected, .rec-mapper-match, .rec-mapper-excluded')
      .forEach(el => {
        el.classList.remove('rec-mapper-hover', 'rec-mapper-selected', 'rec-mapper-match', 'rec-mapper-excluded');
        el.removeAttribute('data-rec-mapper-index');
      });
  }

  // Event handlers
  function handleMouseOver(e) {
    if (!state.isSelectionMode) return;

    const target = e.target;

    // Ignore our own UI elements
    if (target.closest('.rec-mapper-banner, .rec-mapper-results-panel, .rec-mapper-notification')) return;

    // Remove previous hover
    if (state.hoveredElement) {
      state.hoveredElement.classList.remove('rec-mapper-hover');
    }

    // Add hover to new element
    if (!target.classList.contains('rec-mapper-selected') &&
        !target.classList.contains('rec-mapper-match') &&
        !target.classList.contains('rec-mapper-excluded')) {
      target.classList.add('rec-mapper-hover');
      state.hoveredElement = target;
    }
  }

  function handleMouseOut(e) {
    if (!state.isSelectionMode) return;

    const target = e.target;
    target.classList.remove('rec-mapper-hover');

    if (state.hoveredElement === target) {
      state.hoveredElement = null;
    }
  }

  function handleClick(e) {
    if (!state.isSelectionMode) return;

    const target = e.target;

    // Ignore clicks on our UI
    if (target.closest('.rec-mapper-banner, .rec-mapper-results-panel, .rec-mapper-notification')) return;

    e.preventDefault();
    e.stopPropagation();

    // If clicking on a matched element, toggle exclusion
    if (target.classList.contains('rec-mapper-match') || target.classList.contains('rec-mapper-excluded')) {
      toggleElementExclusion(target);
      return;
    }

    // If clicking on a selected element, deselect it
    if (target.classList.contains('rec-mapper-selected')) {
      deselectElement(target);
      return;
    }

    // Select the element
    selectElement(target);
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape') {
      cancelSelection();
    }
  }

  function selectElement(element) {
    element.classList.remove('rec-mapper-hover');
    element.classList.add('rec-mapper-selected');
    element.setAttribute('data-rec-mapper-index', state.selectedElements.length + 1);
    state.selectedElements.push(element);
    updateBanner();
  }

  function deselectElement(element) {
    const index = state.selectedElements.indexOf(element);
    if (index > -1) {
      state.selectedElements.splice(index, 1);
      element.classList.remove('rec-mapper-selected');
      element.removeAttribute('data-rec-mapper-index');

      // Re-index remaining elements
      state.selectedElements.forEach((el, i) => {
        el.setAttribute('data-rec-mapper-index', i + 1);
      });

      updateBanner();
    }
  }

  function toggleElementExclusion(element) {
    const path = PatternMatcher.getSelectorPath(element);
    const resultIndex = state.extractedResults.findIndex(r => r.element?.path === path);

    if (resultIndex >= 0) {
      const wasExcluded = state.extractedResults[resultIndex].excluded;

      if (!wasExcluded) {
        // Excluding: find and exclude similar items
        excludeWithSimilar(resultIndex);
      } else {
        // Re-including: just toggle this one item back
        state.extractedResults[resultIndex].excluded = false;
        element.classList.remove('rec-mapper-excluded');
        element.classList.add('rec-mapper-match');
        renderResultsPanel(null, true);
      }
    }
  }

  // Pattern matching
  function findMatches() {
    if (state.selectedElements.length < 2) return;

    // Clear previous matches
    state.matchedElements.forEach(el => el.classList.remove('rec-mapper-match'));
    state.matchedElements = [];
    state.excludedElements = [];

    // Find matching elements
    const result = PatternMatcher.findMatches(state.selectedElements);

    // Highlight matches
    result.matches.forEach(element => {
      if (!state.selectedElements.includes(element)) {
        element.classList.add('rec-mapper-match');
        state.matchedElements.push(element);
      }
    });

    // Update banner text
    updateBanner();

    // Extract addresses from all elements
    const allElements = [...state.selectedElements, ...state.matchedElements];
    state.extractedResults = extractAddressesFromElements(allElements);

    createResultsPanel();

    // Notify popup of the match count
    chrome.runtime.sendMessage({
      action: 'matchesFound',
      count: allElements.length,
      confidence: result.confidence,
      selector: result.selector
    });
  }

  function extractAddressesFromElements(elements) {
    return elements.map((element, index) => {
      const result = AddressParser.getBestAddress(element);
      const address = result ? result.address : AddressParser.extractText(element);
      return {
        index,
        element: getElementIdentifier(element),
        address: address,
        type: result?.type || 'text',
        url: result?.url || null,
        rawText: AddressParser.extractText(element),
        excluded: false
      };
    }).filter(r => r.address && r.address.length > 0);
  }

  function getElementIdentifier(element) {
    // Create a simple identifier for the element
    return {
      tag: element.tagName.toLowerCase(),
      id: element.id || null,
      classes: Array.from(element.classList).filter(c => !c.startsWith('rec-mapper-')),
      path: PatternMatcher.getSelectorPath(element)
    };
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Message handler from popup/background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.action) {
      case 'startSelection':
        enterSelectionMode();
        sendResponse({ success: true });
        break;

      case 'cancelSelection':
        cancelSelection();
        sendResponse({ success: true });
        break;

      case 'getStatus':
        sendResponse({
          isSelectionMode: state.isSelectionMode,
          selectedCount: state.selectedElements.length,
          matchedCount: state.matchedElements.length
        });
        break;

      case 'cleanup':
        cleanupHighlights();
        if (state.resultsPanel) {
          state.resultsPanel.remove();
          state.resultsPanel = null;
        }
        document.querySelectorAll('.rec-mapper-notification').forEach(el => el.remove());
        sendResponse({ success: true });
        break;

      default:
        sendResponse({ error: 'Unknown action' });
    }

    return true; // Keep message channel open for async response
  });

  // Notify that content script is ready
  chrome.runtime.sendMessage({ action: 'contentScriptReady' });

})();
