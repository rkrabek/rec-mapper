/**
 * Popup Script - Main UI controller for Rec Mapper
 */

(function() {
  'use strict';

  // State
  const state = {
    currentView: 'selection',
    addresses: [],
    selectedAddresses: new Set(),
    searchArea: '',
    apiKey: null,
    geocodedResults: [],
    map: null,
    markers: []
  };

  // DOM Elements - populated after DOM ready
  let elements = {};

  // Initialize DOM references
  function initElements() {
    elements = {
      views: {
        selection: document.getElementById('view-selection'),
        selecting: document.getElementById('view-selecting'),
        review: document.getElementById('view-review'),
        map: document.getElementById('view-map')
      },
      buttons: {
        startSelection: document.getElementById('btn-start-selection'),
        cancelSelection: document.getElementById('btn-cancel-selection'),
        addManual: document.getElementById('btn-add-manual'),
        backSelection: document.getElementById('btn-back-selection'),
        deleteSelected: document.getElementById('btn-delete-selected'),
        mapThese: document.getElementById('btn-map-these'),
        saveData: document.getElementById('btn-save-data'),
        exportData: document.getElementById('btn-export-data'),
        backReview: document.getElementById('btn-back-review'),
        settings: document.getElementById('btn-settings'),
        saveApiKey: document.getElementById('btn-save-api-key'),
        cancelApiKey: document.getElementById('btn-cancel-api-key'),
        changeApiKey: document.getElementById('btn-change-api-key'),
        clearCache: document.getElementById('btn-clear-cache'),
        clearSaved: document.getElementById('btn-clear-saved'),
        manualAdd: document.getElementById('btn-manual-add'),
        manualCancel: document.getElementById('btn-manual-cancel'),
        loadSaved: document.getElementById('btn-load-saved'),
        confirmSave: document.getElementById('btn-confirm-save'),
        cancelSave: document.getElementById('btn-cancel-save')
      },
      selectionCount: document.getElementById('selection-count'),
      reviewCount: document.getElementById('review-count'),
      addressList: document.getElementById('address-list'),
      searchArea: document.getElementById('search-area'),
      mapCount: document.getElementById('map-count'),
      mapContainer: document.getElementById('map'),
      geocodingStatus: document.getElementById('geocoding-status'),
      geocodingProgress: document.getElementById('geocoding-progress'),
      mapErrors: document.getElementById('map-errors'),
      errorList: document.getElementById('error-list'),
      apiKeyModal: document.getElementById('api-key-modal'),
      apiKeyInput: document.getElementById('api-key-input'),
      apiKeyStatus: document.getElementById('api-key-status'),
      settingsPanel: document.getElementById('settings-panel'),
      manualEntry: document.getElementById('manual-entry'),
      manualAddress: document.getElementById('manual-address'),
      savedDataSection: document.getElementById('saved-data-section'),
      savedDataSelect: document.getElementById('saved-data-select'),
      saveModal: document.getElementById('save-modal'),
      saveNameInput: document.getElementById('save-name-input')
    };
  }

  // View management
  function showView(viewName) {
    Object.values(elements.views).forEach(view => view.classList.remove('active'));
    elements.views[viewName].classList.add('active');
    state.currentView = viewName;
  }

  // Initialize
  async function init() {
    initElements();

    // Load API key from storage
    const stored = await chrome.storage.local.get(['googleMapsApiKey', 'savedExtractions']);
    if (stored.googleMapsApiKey) {
      state.apiKey = stored.googleMapsApiKey;
      elements.apiKeyStatus.textContent = '••••' + state.apiKey.slice(-4);
    }

    // Show saved extractions if any
    if (stored.savedExtractions && Object.keys(stored.savedExtractions).length > 0) {
      populateSavedSelect(stored.savedExtractions);
      elements.savedDataSection.classList.remove('hidden');
    }

    // Check if we have addresses from current tab session
    const tabState = await new Promise(resolve => {
      chrome.runtime.sendMessage({ action: 'getTabState' }, resolve);
    });

    if (tabState && tabState.addresses && tabState.addresses.length > 0) {
      state.addresses = tabState.addresses;
      state.selectedAddresses = new Set(state.addresses.map((_, i) => i));
      renderAddressList();
      showView('review');
    }

    // Setup event listeners
    setupEventListeners();
  }

  function populateSavedSelect(saved) {
    const select = elements.savedDataSelect;
    select.innerHTML = '<option value="">Select saved data...</option>';
    Object.keys(saved).forEach(name => {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = `${name} (${saved[name].addresses.length} items)`;
      select.appendChild(option);
    });
  }

  function setupEventListeners() {
    // Start selection
    elements.buttons.startSelection.addEventListener('click', startSelection);

    // Cancel selection
    elements.buttons.cancelSelection.addEventListener('click', cancelSelection);

    // Back to selection
    elements.buttons.backSelection.addEventListener('click', () => {
      cleanupContentScript();
      showView('selection');
    });

    // Add manual address
    elements.buttons.addManual.addEventListener('click', () => {
      elements.manualEntry.classList.remove('hidden');
      elements.manualAddress.focus();
    });

    elements.buttons.manualAdd.addEventListener('click', addManualAddress);
    elements.buttons.manualCancel.addEventListener('click', () => {
      elements.manualEntry.classList.add('hidden');
      elements.manualAddress.value = '';
    });

    // Delete selected
    elements.buttons.deleteSelected.addEventListener('click', deleteSelected);

    // Map these addresses
    elements.buttons.mapThese.addEventListener('click', mapAddresses);

    // Save data
    elements.buttons.saveData.addEventListener('click', () => {
      elements.saveModal.classList.remove('hidden');
      elements.saveNameInput.focus();
    });

    elements.buttons.confirmSave.addEventListener('click', saveData);
    elements.buttons.cancelSave.addEventListener('click', () => {
      elements.saveModal.classList.add('hidden');
      elements.saveNameInput.value = '';
    });

    // Export data
    elements.buttons.exportData.addEventListener('click', exportData);

    // Load saved
    elements.buttons.loadSaved.addEventListener('click', loadSaved);

    // Back to review from map
    elements.buttons.backReview.addEventListener('click', () => {
      showView('review');
    });

    // Settings
    elements.buttons.settings.addEventListener('click', () => {
      elements.settingsPanel.classList.toggle('hidden');
    });

    // API Key
    elements.buttons.changeApiKey.addEventListener('click', () => {
      elements.apiKeyModal.classList.remove('hidden');
      elements.settingsPanel.classList.add('hidden');
    });

    elements.buttons.saveApiKey.addEventListener('click', saveApiKey);
    elements.buttons.cancelApiKey.addEventListener('click', () => {
      elements.apiKeyModal.classList.add('hidden');
    });

    // Clear cache
    elements.buttons.clearCache.addEventListener('click', clearCache);

    // Clear saved
    elements.buttons.clearSaved.addEventListener('click', clearSaved);

    // Search area change
    elements.searchArea.addEventListener('change', (e) => {
      state.searchArea = e.target.value.trim();
    });

    // Listen for messages from content script
    chrome.runtime.onMessage.addListener(handleMessage);

    // Close settings when clicking outside
    document.addEventListener('click', (e) => {
      if (!elements.settingsPanel.classList.contains('hidden') &&
          !elements.settingsPanel.contains(e.target) &&
          e.target !== elements.buttons.settings) {
        elements.settingsPanel.classList.add('hidden');
      }
    });
  }

  // Selection mode
  async function startSelection() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    try {
      await chrome.tabs.sendMessage(tab.id, { action: 'startSelection' });
      showView('selecting');
      elements.selectionCount.textContent = '0';
    } catch (error) {
      // Content script might not be loaded, inject it
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['address-parser.js', 'pattern-matcher.js', 'content.js']
      });
      await chrome.scripting.insertCSS({
        target: { tabId: tab.id },
        files: ['content.css']
      });

      // Try again after a short delay
      setTimeout(async () => {
        try {
          await chrome.tabs.sendMessage(tab.id, { action: 'startSelection' });
          showView('selecting');
        } catch (e) {
          alert('Could not start selection mode. Please refresh the page and try again.');
        }
      }, 100);
    }
  }

  async function cancelSelection() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    try {
      await chrome.tabs.sendMessage(tab.id, { action: 'cancelSelection' });
    } catch (e) {
      // Ignore errors
    }

    showView('selection');
  }

  async function cleanupContentScript() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    try {
      await chrome.tabs.sendMessage(tab.id, { action: 'cleanup' });
    } catch (e) {
      // Ignore errors
    }
  }

  // Handle messages from content script
  function handleMessage(message) {
    switch (message.action) {
      case 'selectionCancelled':
        showView('selection');
        break;

      case 'matchesFound':
        elements.selectionCount.textContent = message.count;
        break;

      case 'addressesExtracted':
        state.addresses = message.addresses;
        state.selectedAddresses = new Set(state.addresses.map((_, i) => i));
        renderAddressList();
        showView('review');
        break;
    }
  }

  // Address list rendering
  function renderAddressList() {
    const list = elements.addressList;
    list.innerHTML = '';

    if (state.addresses.length === 0) {
      list.innerHTML = `
        <div class="empty-state">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/>
            <circle cx="12" cy="10" r="3"/>
          </svg>
          <p>No locations extracted yet</p>
        </div>
      `;
      return;
    }

    state.addresses.forEach((addr, index) => {
      const item = document.createElement('div');
      item.className = 'address-item';
      item.dataset.index = index;

      const isGoogleMapsLink = addr.type === 'google-maps-link';

      item.innerHTML = `
        <input type="checkbox" class="address-checkbox" ${state.selectedAddresses.has(index) ? 'checked' : ''}>
        <div class="address-content">
          <div class="address-display">
            <span class="address-text">${escapeHtml(addr.address)}</span>
            ${isGoogleMapsLink ? '<span class="badge badge-maps">Maps Link</span>' : ''}
          </div>
          <input type="text" class="address-input" value="${escapeHtml(addr.address)}">
          <div class="address-meta">
            <button class="btn-edit">Edit</button>
            <button class="btn-delete">Delete</button>
          </div>
        </div>
      `;

      // Checkbox handler
      const checkbox = item.querySelector('.address-checkbox');
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          state.selectedAddresses.add(index);
        } else {
          state.selectedAddresses.delete(index);
        }
        updateReviewCount();
      });

      // Edit handler
      const editBtn = item.querySelector('.btn-edit');
      const textEl = item.querySelector('.address-text');
      const inputEl = item.querySelector('.address-input');

      editBtn.addEventListener('click', () => {
        if (item.classList.contains('editing')) {
          // Save
          item.classList.remove('editing');
          state.addresses[index].address = inputEl.value;
          textEl.textContent = inputEl.value;
          editBtn.textContent = 'Edit';
        } else {
          // Start editing
          item.classList.add('editing');
          inputEl.value = state.addresses[index].address;
          inputEl.focus();
          inputEl.select();
          editBtn.textContent = 'Save';
        }
      });

      // Save on Enter key
      inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          editBtn.click();
        } else if (e.key === 'Escape') {
          item.classList.remove('editing');
          editBtn.textContent = 'Edit';
        }
      });

      // Delete handler
      item.querySelector('.btn-delete').addEventListener('click', () => {
        state.addresses.splice(index, 1);
        state.selectedAddresses.delete(index);
        // Rebuild selected set with updated indices
        const newSelected = new Set();
        state.selectedAddresses.forEach(i => {
          if (i < index) newSelected.add(i);
          else if (i > index) newSelected.add(i - 1);
        });
        state.selectedAddresses = newSelected;
        renderAddressList();
      });

      list.appendChild(item);
    });

    updateReviewCount();
  }

  function updateReviewCount() {
    elements.reviewCount.textContent = `${state.selectedAddresses.size} of ${state.addresses.length} items selected`;
    elements.buttons.mapThese.disabled = state.selectedAddresses.size === 0;
  }

  function deleteSelected() {
    if (state.selectedAddresses.size === 0) return;

    // Remove selected items (iterate in reverse to maintain indices)
    const toDelete = Array.from(state.selectedAddresses).sort((a, b) => b - a);
    toDelete.forEach(index => {
      state.addresses.splice(index, 1);
    });
    state.selectedAddresses.clear();
    renderAddressList();
  }

  function addManualAddress() {
    const address = elements.manualAddress.value.trim();
    if (!address) return;

    state.addresses.push({
      address,
      type: 'manual',
      index: state.addresses.length
    });

    state.selectedAddresses.add(state.addresses.length - 1);
    renderAddressList();

    elements.manualEntry.classList.add('hidden');
    elements.manualAddress.value = '';
  }

  // Save/Export functionality
  async function saveData() {
    const name = elements.saveNameInput.value.trim();
    if (!name) {
      alert('Please enter a name for this extraction.');
      return;
    }

    const stored = await chrome.storage.local.get('savedExtractions');
    const saved = stored.savedExtractions || {};

    saved[name] = {
      addresses: state.addresses,
      searchArea: state.searchArea,
      savedAt: new Date().toISOString()
    };

    await chrome.storage.local.set({ savedExtractions: saved });

    elements.saveModal.classList.add('hidden');
    elements.saveNameInput.value = '';

    // Update saved dropdown
    populateSavedSelect(saved);
    elements.savedDataSection.classList.remove('hidden');

    alert(`Saved "${name}" with ${state.addresses.length} items.`);
  }

  async function loadSaved() {
    const name = elements.savedDataSelect.value;
    if (!name) return;

    const stored = await chrome.storage.local.get('savedExtractions');
    const saved = stored.savedExtractions?.[name];

    if (saved) {
      state.addresses = saved.addresses;
      state.searchArea = saved.searchArea || '';
      state.selectedAddresses = new Set(state.addresses.map((_, i) => i));
      elements.searchArea.value = state.searchArea;
      renderAddressList();
      showView('review');
    }
  }

  function exportData() {
    const data = {
      addresses: state.addresses,
      searchArea: state.searchArea,
      exportedAt: new Date().toISOString()
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `rec-mapper-export-${Date.now()}.json`;
    a.click();

    URL.revokeObjectURL(url);
  }

  async function clearSaved() {
    if (!confirm('Are you sure you want to delete all saved extractions?')) return;

    await chrome.storage.local.remove('savedExtractions');
    elements.savedDataSection.classList.add('hidden');
    elements.savedDataSelect.innerHTML = '<option value="">Select saved data...</option>';
  }

  // Mapping
  async function mapAddresses() {
    // Check for API key
    if (!state.apiKey) {
      elements.apiKeyModal.classList.remove('hidden');
      return;
    }

    // Get selected addresses
    const selected = state.addresses.filter((_, i) => state.selectedAddresses.has(i));

    if (selected.length === 0) {
      alert('Please select at least one location to map.');
      return;
    }

    showView('map');
    elements.geocodingStatus.classList.remove('hidden');
    elements.mapErrors.classList.add('hidden');

    // Get search area suffix
    const searchArea = elements.searchArea.value.trim();

    // Geocode addresses
    const results = await geocodeAddresses(selected, searchArea);
    state.geocodedResults = results;

    elements.geocodingStatus.classList.add('hidden');

    // Show errors if any
    const errors = results.filter(r => !r.geocode.success);
    if (errors.length > 0) {
      elements.mapErrors.classList.remove('hidden');
      elements.errorList.innerHTML = errors
        .map(e => `<li>${escapeHtml(e.address)}: ${e.geocode.error}</li>`)
        .join('');
    }

    // Show map
    const successful = results.filter(r => r.geocode.success);
    elements.mapCount.textContent = `${successful.length} locations mapped`;

    if (successful.length > 0) {
      initMap(successful);
    }
  }

  async function geocodeAddresses(addresses, searchArea) {
    const results = [];

    for (let i = 0; i < addresses.length; i++) {
      elements.geocodingProgress.textContent = `${i + 1}/${addresses.length}`;

      // Append search area if provided
      let queryAddress = addresses[i].address;
      if (searchArea && !addresses[i].address.toLowerCase().includes(searchArea.toLowerCase())) {
        queryAddress = `${addresses[i].address}, ${searchArea}`;
      }

      const result = await new Promise(resolve => {
        chrome.runtime.sendMessage({
          action: 'geocodeAddress',
          address: queryAddress,
          apiKey: state.apiKey
        }, resolve);
      });

      results.push({
        ...addresses[i],
        queryAddress,
        geocode: result
      });

      // Small delay to avoid rate limiting
      if (i < addresses.length - 1) {
        await new Promise(r => setTimeout(r, 100));
      }
    }

    return results;
  }

  function initMap(locations) {
    // Load Google Maps if not already loaded
    if (!window.google || !window.google.maps) {
      const script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?key=${state.apiKey}&callback=initMapCallback`;
      script.async = true;
      script.defer = true;

      window.initMapCallback = () => {
        createMap(locations);
      };

      document.head.appendChild(script);
    } else {
      createMap(locations);
    }
  }

  function createMap(locations) {
    // Clear existing markers
    state.markers.forEach(m => m.setMap(null));
    state.markers = [];

    // Calculate bounds
    const bounds = new google.maps.LatLngBounds();
    locations.forEach(loc => {
      bounds.extend({ lat: loc.geocode.lat, lng: loc.geocode.lng });
    });

    // Create map
    state.map = new google.maps.Map(elements.mapContainer, {
      center: bounds.getCenter(),
      zoom: 12,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false
    });

    // Fit bounds
    state.map.fitBounds(bounds);

    // Add markers
    locations.forEach((loc, index) => {
      const marker = new google.maps.Marker({
        position: { lat: loc.geocode.lat, lng: loc.geocode.lng },
        map: state.map,
        title: loc.address,
        label: {
          text: String(index + 1),
          color: 'white',
          fontWeight: 'bold'
        }
      });

      // Show match quality indicator
      const matchQuality = loc.geocode.partialMatch ? 'Approximate match' :
                          loc.geocode.locationType === 'ROOFTOP' ? 'Exact match' :
                          loc.geocode.locationType === 'RANGE_INTERPOLATED' ? 'Interpolated' : 'Approximate';

      const infoWindow = new google.maps.InfoWindow({
        content: `
          <div style="max-width: 220px; font-family: sans-serif; font-size: 13px;">
            <strong>${escapeHtml(loc.geocode.formattedAddress || loc.address)}</strong>
            <div style="margin-top: 6px; font-size: 11px; color: #666;">
              <em>Original: ${escapeHtml(loc.address)}</em>
            </div>
            <div style="margin-top: 4px; font-size: 10px; color: ${loc.geocode.partialMatch ? '#b45309' : '#059669'};">
              ${matchQuality}
            </div>
          </div>
        `
      });

      marker.addListener('click', () => {
        infoWindow.open(state.map, marker);
      });

      state.markers.push(marker);
    });
  }

  // API Key management
  async function saveApiKey() {
    const key = elements.apiKeyInput.value.trim();

    if (!key) {
      alert('Please enter an API key.');
      return;
    }

    // Validate the key with a test request
    try {
      const testUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=test&key=${key}`;
      const response = await fetch(testUrl);
      const data = await response.json();

      if (data.status === 'REQUEST_DENIED') {
        alert('Invalid API key. Please check your key and try again.');
        return;
      }
    } catch (error) {
      alert('Could not validate API key. Please try again.');
      return;
    }

    state.apiKey = key;
    await chrome.storage.local.set({ googleMapsApiKey: key });

    elements.apiKeyStatus.textContent = '••••' + key.slice(-4);
    elements.apiKeyModal.classList.add('hidden');
    elements.apiKeyInput.value = '';

    // If we were trying to map, continue
    if (state.currentView === 'map') {
      mapAddresses();
    }
  }

  async function clearCache() {
    const items = await chrome.storage.local.get();
    const keysToRemove = Object.keys(items).filter(k => k.startsWith('geocode_'));

    if (keysToRemove.length > 0) {
      await chrome.storage.local.remove(keysToRemove);
      alert(`Cleared ${keysToRemove.length} cached geocode results.`);
    } else {
      alert('Cache is already empty.');
    }
  }

  // Utilities
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Start
  init();

})();
