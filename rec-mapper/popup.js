/**
 * Popup Script - Simple launcher and settings for Rec Mapper
 */

(function() {
  'use strict';

  // State
  const state = {
    mapProvider: 'osm',
    apiKey: null
  };

  // DOM Elements
  let elements = {};

  function initElements() {
    elements = {
      views: {
        main: document.getElementById('view-main'),
        selecting: document.getElementById('view-selecting')
      },
      buttons: {
        startSelection: document.getElementById('btn-start-selection'),
        cancelSelection: document.getElementById('btn-cancel-selection'),
        settings: document.getElementById('btn-settings'),
        saveApiKey: document.getElementById('btn-save-api-key'),
        cancelApiKey: document.getElementById('btn-cancel-api-key'),
        changeApiKey: document.getElementById('btn-change-api-key'),
        clearCache: document.getElementById('btn-clear-cache'),
        clearSaved: document.getElementById('btn-clear-saved'),
        loadSaved: document.getElementById('btn-load-saved')
      },
      apiKeyModal: document.getElementById('api-key-modal'),
      apiKeyInput: document.getElementById('api-key-input'),
      apiKeyStatus: document.getElementById('api-key-status'),
      googleKeySection: document.getElementById('google-key-section'),
      settingsPanel: document.getElementById('settings-panel'),
      savedDataSection: document.getElementById('saved-data-section'),
      savedDataSelect: document.getElementById('saved-data-select'),
      mapProviderRadios: document.querySelectorAll('input[name="map-provider"]')
    };
  }

  // View management
  function showView(viewName) {
    Object.values(elements.views).forEach(view => view.classList.remove('active'));
    elements.views[viewName].classList.add('active');
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
      elements.mapProviderRadios.forEach(radio => {
        radio.checked = radio.value === state.mapProvider;
      });
    }

    updateProviderUI();

    // Show saved extractions if any
    if (stored.savedExtractions && Object.keys(stored.savedExtractions).length > 0) {
      populateSavedSelect(stored.savedExtractions);
      elements.savedDataSection.classList.remove('hidden');
    }

    // Check if selection mode is already active
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { action: 'getStatus' });
        if (response && response.isSelectionMode) {
          showView('selecting');
        }
      } catch (e) {
        // Content script not loaded yet, that's fine
      }
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

    // Load saved and map directly
    elements.buttons.loadSaved.addEventListener('click', loadAndMapSaved);

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
    } catch (error) {
      // Content script not loaded, inject it
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
    showView('main');
  }

  function handleMessage(message) {
    if (message.action === 'selectionCancelled') {
      showView('main');
    }
  }

  // Load saved extraction and open map directly
  async function loadAndMapSaved() {
    const name = elements.savedDataSelect.value;
    if (!name) {
      alert('Please select a saved extraction.');
      return;
    }

    const stored = await chrome.storage.local.get('savedExtractions');
    const saved = stored.savedExtractions?.[name];

    if (saved) {
      // Save as mapData and open map tab
      await chrome.storage.local.set({
        mapData: {
          addresses: saved.addresses,
          searchArea: saved.searchArea || '',
          timestamp: Date.now()
        }
      });

      chrome.tabs.create({
        url: chrome.runtime.getURL('map.html')
      });
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
  }

  async function clearCache() {
    const count = await Geocoder.clearCache();
    alert(`Cleared ${count} cached geocode results.`);
  }

  async function clearSaved() {
    if (!confirm('Delete all saved extractions?')) return;
    await chrome.storage.local.remove('savedExtractions');
    elements.savedDataSection.classList.add('hidden');
    elements.savedDataSelect.innerHTML = '<option value="">Select saved data...</option>';
  }

  // Start
  init();

})();
