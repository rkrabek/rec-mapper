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
      const text = state.banner.querySelector('.rec-mapper-banner-text span');
      text.textContent = `${state.matchedElements.length} matches found. Click to remove false positives.`;
    }
  }

  function createResultsPanel(results) {
    // Remove existing panel
    if (state.resultsPanel) {
      state.resultsPanel.remove();
    }

    const panel = document.createElement('div');
    panel.className = 'rec-mapper-results-panel';

    const itemsHtml = results.slice(0, 10).map((r, i) => `
      <div class="rec-mapper-result-item">
        ${r.address}
      </div>
    `).join('');

    panel.innerHTML = `
      <div class="rec-mapper-results-header">
        Extracted Addresses
      </div>
      <div class="rec-mapper-results-body">
        ${itemsHtml}
        ${results.length > 10 ? `<div class="rec-mapper-result-item" style="text-align: center; color: #6b7280;">...and ${results.length - 10} more</div>` : ''}
      </div>
      <div class="rec-mapper-results-footer">
        <span class="rec-mapper-results-count">${results.length} addresses</span>
        <button class="rec-mapper-btn rec-mapper-btn-done" id="rec-mapper-send-to-popup">Send to Popup</button>
      </div>
    `;

    panel.querySelector('#rec-mapper-send-to-popup').addEventListener('click', () => {
      sendResultsToPopup(results);
    });

    document.body.appendChild(panel);
    state.resultsPanel = panel;
  }

  // Selection mode handlers
  function enterSelectionMode() {
    if (state.isSelectionMode) return;

    state.isSelectionMode = true;
    state.selectedElements = [];
    state.matchedElements = [];
    state.excludedElements = [];

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
    if (!keepResults && state.resultsPanel) {
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
    if (target.closest('.rec-mapper-banner, .rec-mapper-results-panel')) return;

    // Remove previous hover
    if (state.hoveredElement) {
      state.hoveredElement.classList.remove('rec-mapper-hover');
    }

    // Add hover to new element
    if (!target.classList.contains('rec-mapper-selected') &&
        !target.classList.contains('rec-mapper-match')) {
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
    if (target.closest('.rec-mapper-banner, .rec-mapper-results-panel')) return;

    e.preventDefault();
    e.stopPropagation();

    // If clicking on a matched element, toggle exclusion
    if (target.classList.contains('rec-mapper-match')) {
      toggleExclusion(target);
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

  function toggleExclusion(element) {
    if (element.classList.contains('rec-mapper-excluded')) {
      element.classList.remove('rec-mapper-excluded');
      element.classList.add('rec-mapper-match');
      const index = state.excludedElements.indexOf(element);
      if (index > -1) {
        state.excludedElements.splice(index, 1);
        state.matchedElements.push(element);
      }
    } else {
      element.classList.remove('rec-mapper-match');
      element.classList.add('rec-mapper-excluded');
      const index = state.matchedElements.indexOf(element);
      if (index > -1) {
        state.matchedElements.splice(index, 1);
        state.excludedElements.push(element);
      }
    }
    updateBanner();
    updateResultsPanel();
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

    // Extract and show results
    const allElements = [...state.selectedElements, ...state.matchedElements];
    const results = extractAddressesFromElements(allElements);

    createResultsPanel(results);

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
        rawText: AddressParser.extractText(element)
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

  function updateResultsPanel() {
    if (!state.resultsPanel) return;

    const allElements = [...state.selectedElements, ...state.matchedElements];
    const results = extractAddressesFromElements(allElements);
    createResultsPanel(results);
  }

  function sendResultsToPopup(results) {
    chrome.runtime.sendMessage({
      action: 'addressesExtracted',
      addresses: results,
      pageUrl: window.location.href,
      pageTitle: document.title
    });

    // Keep highlights but exit selection mode
    exitSelectionMode(true);
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

      case 'highlightElement':
        // Scroll to and briefly highlight a specific element
        const elements = document.querySelectorAll(message.selector);
        if (elements[message.index]) {
          const el = elements[message.index];
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.style.outline = '3px solid #667eea';
          setTimeout(() => {
            el.style.outline = '';
          }, 2000);
        }
        sendResponse({ success: true });
        break;

      case 'cleanup':
        cleanupHighlights();
        if (state.resultsPanel) {
          state.resultsPanel.remove();
          state.resultsPanel = null;
        }
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
