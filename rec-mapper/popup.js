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
    mapProvider: 'osm', // 'osm' or 'google'
    apiKey: null,
    geocodedResults: [],
    mapInstance: null,
    // For disambiguation handling
    pendingGeocode: null,
    geocodeQueue: [],
    currentGeocodingIndex: 0
  };

  // DOM Elements
  let elements = {};

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
        cancelSave: document.getElementById('btn-cancel-save'),
        skipDisambig: document.getElementById('btn-skip-disambig'),
        addCoords: document.getElementById('btn-add-coords'),
        skipCoords: document.getElementById('btn-skip-coords')
      },
      selectionCount: document.getElementById('selection-count'),
      reviewCount: document.getElementById('review-count'),
      addressList: document.getElementById('address-list'),
      searchArea: document.getElementById('search-area'),
      mapCount: document.getElementById('map-count'),
      mapContainer: document.getElementById('map'),
      geocodingStatus: document.getElementById('geocoding-status'),
      geocodingText: document.getElementById('geocoding-text'),
      geocodingProgress: document.getElementById('geocoding-progress'),
      mapErrors: document.getElementById('map-errors'),
      errorList: document.getElementById('error-list'),
      apiKeyModal: document.getElementById('api-key-modal'),
      apiKeyInput: document.getElementById('api-key-input'),
      apiKeyStatus: document.getElementById('api-key-status'),
      googleKeySection: document.getElementById('google-key-section'),
      settingsPanel: document.getElementById('settings-panel'),
      manualEntry: document.getElementById('manual-entry'),
      manualAddress: document.getElementById('manual-address'),
      savedDataSection: document.getElementById('saved-data-section'),
      savedDataSelect: document.getElementById('saved-data-select'),
      saveModal: document.getElementById('save-modal'),
      saveNameInput: document.getElementById('save-name-input'),
      disambigSection: document.getElementById('disambiguation-section'),
      disambigAddress: document.getElementById('disambig-address'),
      disambigOptions: document.getElementById('disambig-options'),
      manualCoordSection: document.getElementById('manual-coord-section'),
      manualCoordAddress: document.getElementById('manual-coord-address'),
      manualLat: document.getElementById('manual-lat'),
      manualLng: document.getElementById('manual-lng'),
      mapProviderRadios: document.querySelectorAll('input[name="map-provider"]')
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

    // Load settings from storage
    const stored = await chrome.storage.local.get([
      'googleMapsApiKey',
      'savedExtractions',
      'mapProvider'
    ]);

    if (stored.googleMapsApiKey) {
      state.apiKey = stored.googleMapsApiKey;
      elements.apiKeyStatus.textContent = '••••' + state.apiKey.slice(-4);
    }

    if (stored.mapProvider) {
      state.mapProvider = stored.mapProvider;
      // Update radio buttons
      elements.mapProviderRadios.forEach(radio => {
        radio.checked = radio.value === state.mapProvider;
      });
    }

    // Show/hide Google API key section based on provider
    updateProviderUI();

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

    setupEventListeners();
  }

  function updateProviderUI() {
    if (state.mapProvider === 'google') {
      elements.googleKeySection.classList.remove('hidden');
    } else {
      elements.googleKeySection.classList.add('hidden');
    }
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
      if (state.mapInstance) {
        state.mapInstance.destroy();
        state.mapInstance = null;
      }
      showView('review');
    });

    // Settings
    elements.buttons.settings.addEventListener('click', () => {
      elements.settingsPanel.classList.toggle('hidden');
    });

    // Map provider selection
    elements.mapProviderRadios.forEach(radio => {
      radio.addEventListener('change', async (e) => {
        state.mapProvider = e.target.value;
        await chrome.storage.local.set({ mapProvider: state.mapProvider });
        updateProviderUI();

        // If switching to Google and no API key, show modal
        if (state.mapProvider === 'google' && !state.apiKey) {
          elements.apiKeyModal.classList.remove('hidden');
        }
      });
    });

    // API Key
    elements.buttons.changeApiKey.addEventListener('click', () => {
      elements.apiKeyModal.classList.remove('hidden');
      elements.settingsPanel.classList.add('hidden');
    });

    elements.buttons.saveApiKey.addEventListener('click', saveApiKey);
    elements.buttons.cancelApiKey.addEventListener('click', () => {
      elements.apiKeyModal.classList.add('hidden');
      // If canceling and no key, switch back to OSM
      if (!state.apiKey && state.mapProvider === 'google') {
        state.mapProvider = 'osm';
        elements.mapProviderRadios.forEach(r => r.checked = r.value === 'osm');
        updateProviderUI();
        chrome.storage.local.set({ mapProvider: 'osm' });
      }
    });

    // Clear cache
    elements.buttons.clearCache.addEventListener('click', clearCache);

    // Clear saved
    elements.buttons.clearSaved.addEventListener('click', clearSaved);

    // Search area change
    elements.searchArea.addEventListener('change', (e) => {
      state.searchArea = e.target.value.trim();
    });

    // Disambiguation handlers
    elements.buttons.skipDisambig.addEventListener('click', skipCurrentGeocode);

    // Manual coordinate handlers
    elements.buttons.addCoords.addEventListener('click', addManualCoordinates);
    elements.buttons.skipCoords.addEventListener('click', skipCurrentGeocode);

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
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['address-parser.js', 'pattern-matcher.js', 'content.js']
      });
      await chrome.scripting.insertCSS({
        target: { tabId: tab.id },
        files: ['content.css']
      });

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
    } catch (e) {}
    showView('selection');
  }

  async function cleanupContentScript() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    try {
      await chrome.tabs.sendMessage(tab.id, { action: 'cleanup' });
    } catch (e) {}
  }

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

      const checkbox = item.querySelector('.address-checkbox');
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          state.selectedAddresses.add(index);
        } else {
          state.selectedAddresses.delete(index);
        }
        updateReviewCount();
      });

      const editBtn = item.querySelector('.btn-edit');
      const textEl = item.querySelector('.address-text');
      const inputEl = item.querySelector('.address-input');

      editBtn.addEventListener('click', () => {
        if (item.classList.contains('editing')) {
          item.classList.remove('editing');
          state.addresses[index].address = inputEl.value;
          textEl.textContent = inputEl.value;
          editBtn.textContent = 'Edit';
        } else {
          item.classList.add('editing');
          inputEl.value = state.addresses[index].address;
          inputEl.focus();
          inputEl.select();
          editBtn.textContent = 'Save';
        }
      });

      inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') editBtn.click();
        else if (e.key === 'Escape') {
          item.classList.remove('editing');
          editBtn.textContent = 'Edit';
        }
      });

      item.querySelector('.btn-delete').addEventListener('click', () => {
        state.addresses.splice(index, 1);
        state.selectedAddresses.delete(index);
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
    const toDelete = Array.from(state.selectedAddresses).sort((a, b) => b - a);
    toDelete.forEach(index => state.addresses.splice(index, 1));
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

  // Save/Export
  async function saveData() {
    const name = elements.saveNameInput.value.trim();
    if (!name) {
      alert('Please enter a name.');
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
    if (!confirm('Delete all saved extractions?')) return;
    await chrome.storage.local.remove('savedExtractions');
    elements.savedDataSection.classList.add('hidden');
    elements.savedDataSelect.innerHTML = '<option value="">Select saved data...</option>';
  }

  // Mapping
  async function mapAddresses() {
    // Check for API key if using Google
    if (state.mapProvider === 'google' && !state.apiKey) {
      elements.apiKeyModal.classList.remove('hidden');
      return;
    }

    const selected = state.addresses.filter((_, i) => state.selectedAddresses.has(i));
    if (selected.length === 0) {
      alert('Please select at least one location.');
      return;
    }

    showView('map');
    elements.geocodingStatus.classList.remove('hidden');
    elements.mapErrors.classList.add('hidden');
    elements.disambigSection.classList.add('hidden');
    elements.manualCoordSection.classList.add('hidden');

    // Prepare geocoding queue
    const searchArea = elements.searchArea.value.trim();
    state.geocodeQueue = selected.map(addr => {
      let queryAddress = addr.address;
      if (searchArea && !addr.address.toLowerCase().includes(searchArea.toLowerCase())) {
        queryAddress = `${addr.address}, ${searchArea}`;
      }
      return { ...addr, queryAddress };
    });

    state.geocodedResults = [];
    state.currentGeocodingIndex = 0;

    // Start geocoding
    await processGeocodeQueue();
  }

  async function processGeocodeQueue() {
    const errors = [];

    while (state.currentGeocodingIndex < state.geocodeQueue.length) {
      const item = state.geocodeQueue[state.currentGeocodingIndex];

      // Update progress
      elements.geocodingText.textContent = `Geocoding: ${item.address.substring(0, 30)}...`;
      elements.geocodingProgress.textContent = `${state.currentGeocodingIndex + 1}/${state.geocodeQueue.length}`;

      const result = await Geocoder.geocode(item.queryAddress, state.mapProvider, state.apiKey);

      if (result.success) {
        // Check if disambiguation is needed
        if (result.multipleResults && result.allResults.length > 1) {
          // Show disambiguation UI
          state.pendingGeocode = { item, result };
          showDisambiguation(item.address, result.allResults);
          return; // Wait for user selection
        }

        state.geocodedResults.push({
          ...item,
          geocode: result
        });
      } else if (result.noResults) {
        // Show manual coordinate entry
        state.pendingGeocode = { item, result };
        showManualCoordEntry(item.address);
        return; // Wait for user input
      } else {
        errors.push({ address: item.address, error: result.error });
      }

      state.currentGeocodingIndex++;
    }

    // Geocoding complete
    elements.geocodingStatus.classList.add('hidden');

    if (errors.length > 0) {
      elements.mapErrors.classList.remove('hidden');
      elements.errorList.innerHTML = errors
        .map(e => `<li>${escapeHtml(e.address)}: ${e.error}</li>`)
        .join('');
    }

    elements.mapCount.textContent = `${state.geocodedResults.length} locations mapped`;

    if (state.geocodedResults.length > 0) {
      await displayMap();
    }
  }

  function showDisambiguation(address, options) {
    elements.geocodingStatus.classList.add('hidden');
    elements.disambigSection.classList.remove('hidden');
    elements.disambigAddress.textContent = address;

    elements.disambigOptions.innerHTML = options.slice(0, 5).map((opt, i) => `
      <div class="disambig-option" data-index="${i}">
        ${escapeHtml(opt.formattedAddress)}
      </div>
    `).join('');

    // Add click handlers
    elements.disambigOptions.querySelectorAll('.disambig-option').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.index);
        selectDisambigOption(options[idx]);
      });
    });
  }

  function selectDisambigOption(option) {
    const { item } = state.pendingGeocode;

    state.geocodedResults.push({
      ...item,
      geocode: {
        success: true,
        lat: option.lat,
        lng: option.lng,
        formattedAddress: option.formattedAddress,
        placeId: option.placeId
      }
    });

    elements.disambigSection.classList.add('hidden');
    elements.geocodingStatus.classList.remove('hidden');
    state.pendingGeocode = null;
    state.currentGeocodingIndex++;
    processGeocodeQueue();
  }

  function showManualCoordEntry(address) {
    elements.geocodingStatus.classList.add('hidden');
    elements.manualCoordSection.classList.remove('hidden');
    elements.manualCoordAddress.textContent = address;
    elements.manualLat.value = '';
    elements.manualLng.value = '';
  }

  function addManualCoordinates() {
    const lat = parseFloat(elements.manualLat.value);
    const lng = parseFloat(elements.manualLng.value);

    if (isNaN(lat) || isNaN(lng)) {
      alert('Please enter valid coordinates.');
      return;
    }

    const { item } = state.pendingGeocode;

    state.geocodedResults.push({
      ...item,
      geocode: {
        success: true,
        lat,
        lng,
        formattedAddress: item.address,
        manual: true
      }
    });

    elements.manualCoordSection.classList.add('hidden');
    elements.geocodingStatus.classList.remove('hidden');
    state.pendingGeocode = null;
    state.currentGeocodingIndex++;
    processGeocodeQueue();
  }

  function skipCurrentGeocode() {
    elements.disambigSection.classList.add('hidden');
    elements.manualCoordSection.classList.add('hidden');
    elements.geocodingStatus.classList.remove('hidden');
    state.pendingGeocode = null;
    state.currentGeocodingIndex++;
    processGeocodeQueue();
  }

  async function displayMap() {
    // Clean up existing map
    if (state.mapInstance) {
      state.mapInstance.destroy();
    }

    try {
      // Create map provider instance
      state.mapInstance = await MapProviderFactory.create(
        state.mapProvider,
        elements.mapContainer,
        { apiKey: state.apiKey }
      );

      // Add markers
      state.geocodedResults.forEach((loc, index) => {
        const matchQuality = loc.geocode.manual ? 'Manual entry' :
          loc.geocode.partialMatch ? 'Approximate match' :
          loc.geocode.locationType === 'ROOFTOP' ? 'Exact match' : 'Approximate';

        state.mapInstance.addMarker(
          loc.geocode.lat,
          loc.geocode.lng,
          loc.address,
          {
            label: index + 1,
            formattedAddress: loc.geocode.formattedAddress,
            originalAddress: loc.address,
            matchQuality
          }
        );
      });

      // Fit bounds to show all markers
      state.mapInstance.fitBounds();

    } catch (error) {
      console.error('Map error:', error);
      elements.mapErrors.classList.remove('hidden');
      elements.errorList.innerHTML = `<li>Failed to load map: ${error.message}</li>`;
    }
  }

  // API Key management
  async function saveApiKey() {
    const key = elements.apiKeyInput.value.trim();
    if (!key) {
      alert('Please enter an API key.');
      return;
    }

    // Validate key
    try {
      const testUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=test&key=${key}`;
      const response = await fetch(testUrl);
      const data = await response.json();

      if (data.status === 'REQUEST_DENIED') {
        alert('Invalid API key.');
        return;
      }
    } catch (error) {
      alert('Could not validate API key.');
      return;
    }

    state.apiKey = key;
    await chrome.storage.local.set({ googleMapsApiKey: key });

    elements.apiKeyStatus.textContent = '••••' + key.slice(-4);
    elements.apiKeyModal.classList.add('hidden');
    elements.apiKeyInput.value = '';

    if (state.currentView === 'map') {
      mapAddresses();
    }
  }

  async function clearCache() {
    const count = await Geocoder.clearCache();
    alert(`Cleared ${count} cached geocode results.`);
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
