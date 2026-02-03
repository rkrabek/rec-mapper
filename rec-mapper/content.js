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

  function renderResultsPanel(panel) {
    if (!panel) panel = state.resultsPanel;
    if (!panel) return;

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

    panel.innerHTML = `
      <div class="rec-mapper-results-header">
        <span>Extracted Locations</span>
        <span class="rec-mapper-results-count">${includedCount} of ${results.length}</span>
      </div>
      <div class="rec-mapper-results-body">
        ${itemsHtml || '<div class="rec-mapper-result-item" style="color: #6b7280; text-align: center;">No results</div>'}
      </div>
      <div class="rec-mapper-results-footer">
        <button class="rec-mapper-btn rec-mapper-btn-cancel" id="rec-mapper-refine">Refine Pattern</button>
        <button class="rec-mapper-btn rec-mapper-btn-done" id="rec-mapper-done">Done - Open Popup</button>
      </div>
    `;

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
        state.extractedResults[index].excluded = !state.extractedResults[index].excluded;
        renderResultsPanel();
        updateHighlights();
      });
    });

    // Refine pattern button
    panel.querySelector('#rec-mapper-refine').addEventListener('click', refinePattern);

    // Done button - stores data and notifies user to open popup
    panel.querySelector('#rec-mapper-done').addEventListener('click', finishSelection);
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

  function finishSelection() {
    // Store data in background script
    const includedResults = state.extractedResults.filter(r => !r.excluded);

    chrome.runtime.sendMessage({
      action: 'addressesExtracted',
      addresses: includedResults,
      pageUrl: window.location.href,
      pageTitle: document.title
    });

    // Show notification
    const notification = document.createElement('div');
    notification.className = 'rec-mapper-notification';
    notification.innerHTML = `
      <span>✓ ${includedResults.length} locations saved! Click the extension icon to continue.</span>
    `;
    document.body.appendChild(notification);

    setTimeout(() => {
      notification.remove();
    }, 4000);

    // Keep highlights but exit selection mode
    exitSelectionMode(true);
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
      state.extractedResults[resultIndex].excluded = !state.extractedResults[resultIndex].excluded;

      if (state.extractedResults[resultIndex].excluded) {
        element.classList.remove('rec-mapper-match');
        element.classList.add('rec-mapper-excluded');
      } else {
        element.classList.remove('rec-mapper-excluded');
        element.classList.add('rec-mapper-match');
      }

      renderResultsPanel();
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
