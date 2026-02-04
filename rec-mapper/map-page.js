/**
 * Map Page Script - Handles the standalone map view
 */

(function() {
  'use strict';

  // State
  const state = {
    addresses: [],
    searchArea: '',
    mapProvider: 'osm',
    apiKey: null,
    geocodedResults: [],
    mapInstance: null,
    currentGeocodingIndex: 0,
    pendingGeocode: null
  };

  // DOM Elements
  const elements = {
    headerStats: document.getElementById('header-stats'),
    locationCount: document.getElementById('location-count'),
    locationList: document.getElementById('location-list'),
    map: document.getElementById('map'),
    loadingOverlay: document.getElementById('loading-overlay'),
    loadingText: document.getElementById('loading-text'),
    loadingProgress: document.getElementById('loading-progress'),
    disambigModal: document.getElementById('disambig-modal'),
    disambigAddress: document.getElementById('disambig-address'),
    disambigOptions: document.getElementById('disambig-options'),
    coordModal: document.getElementById('coord-modal'),
    coordAddress: document.getElementById('coord-address'),
    manualLat: document.getElementById('manual-lat'),
    manualLng: document.getElementById('manual-lng'),
    btnSkip: document.getElementById('btn-skip'),
    btnAddCoords: document.getElementById('btn-add-coords'),
    btnSkipCoords: document.getElementById('btn-skip-coords')
  };

  // Initialize
  async function init() {
    // Load data from storage
    const stored = await chrome.storage.local.get([
      'mapData',
      'googleMapsApiKey',
      'mapProvider'
    ]);

    if (!stored.mapData || !stored.mapData.addresses || stored.mapData.addresses.length === 0) {
      showEmptyState();
      return;
    }

    state.addresses = stored.mapData.addresses;
    state.searchArea = stored.mapData.searchArea || '';
    state.apiKey = stored.googleMapsApiKey || null;
    state.mapProvider = stored.mapProvider || 'osm';

    // Check if Google Maps selected but no API key
    if (state.mapProvider === 'google' && !state.apiKey) {
      state.mapProvider = 'osm'; // Fall back to OSM
    }

    setupEventListeners();
    await startGeocoding();
  }

  function showEmptyState() {
    elements.loadingOverlay.classList.add('hidden');
    elements.locationList.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/>
          <circle cx="12" cy="10" r="3"/>
        </svg>
        <p>No locations to display</p>
      </div>
    `;
    elements.headerStats.textContent = 'No data';
  }

  function setupEventListeners() {
    elements.btnSkip.addEventListener('click', skipCurrentGeocode);
    elements.btnAddCoords.addEventListener('click', addManualCoordinates);
    elements.btnSkipCoords.addEventListener('click', skipCurrentGeocode);
  }

  async function startGeocoding() {
    state.geocodedResults = [];
    state.currentGeocodingIndex = 0;

    elements.loadingOverlay.classList.remove('hidden');
    elements.loadingProgress.textContent = `0 / ${state.addresses.length}`;

    await processGeocodeQueue();
  }

  async function processGeocodeQueue() {
    while (state.currentGeocodingIndex < state.addresses.length) {
      const item = state.addresses[state.currentGeocodingIndex];

      // Build query address with search area
      let queryAddress = item.address;
      if (state.searchArea && !item.address.toLowerCase().includes(state.searchArea.toLowerCase())) {
        queryAddress = `${item.address}, ${state.searchArea}`;
      }

      // Update progress
      elements.loadingText.textContent = `Geocoding: ${item.address.substring(0, 40)}${item.address.length > 40 ? '...' : ''}`;
      elements.loadingProgress.textContent = `${state.currentGeocodingIndex + 1} / ${state.addresses.length}`;

      const result = await Geocoder.geocode(queryAddress, state.mapProvider, state.apiKey);

      if (result.success) {
        // Check if disambiguation is needed
        if (result.multipleResults && result.allResults.length > 1) {
          state.pendingGeocode = { item, queryAddress, result };
          showDisambiguation(item.address, result.allResults);
          return; // Wait for user selection
        }

        state.geocodedResults.push({
          ...item,
          queryAddress,
          geocode: result
        });
      } else if (result.noResults) {
        state.pendingGeocode = { item, queryAddress, result };
        showManualCoordEntry(item.address);
        return; // Wait for user input
      } else {
        // Error - add with error state
        state.geocodedResults.push({
          ...item,
          queryAddress,
          geocode: result,
          error: true
        });
      }

      state.currentGeocodingIndex++;
    }

    // Geocoding complete
    elements.loadingOverlay.classList.add('hidden');
    await displayResults();
  }

  function showDisambiguation(address, options) {
    elements.loadingOverlay.classList.add('hidden');
    elements.disambigModal.classList.remove('hidden');
    elements.disambigAddress.textContent = `Select the correct location for "${address}":`;

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
    const { item, queryAddress } = state.pendingGeocode;

    state.geocodedResults.push({
      ...item,
      queryAddress,
      geocode: {
        success: true,
        lat: option.lat,
        lng: option.lng,
        formattedAddress: option.formattedAddress,
        placeId: option.placeId
      }
    });

    elements.disambigModal.classList.add('hidden');
    elements.loadingOverlay.classList.remove('hidden');
    state.pendingGeocode = null;
    state.currentGeocodingIndex++;
    processGeocodeQueue();
  }

  function showManualCoordEntry(address) {
    elements.loadingOverlay.classList.add('hidden');
    elements.coordModal.classList.remove('hidden');
    elements.coordAddress.textContent = `Could not find "${address}". Enter coordinates manually:`;
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

    const { item, queryAddress } = state.pendingGeocode;

    state.geocodedResults.push({
      ...item,
      queryAddress,
      geocode: {
        success: true,
        lat,
        lng,
        formattedAddress: item.address,
        manual: true
      }
    });

    elements.coordModal.classList.add('hidden');
    elements.loadingOverlay.classList.remove('hidden');
    state.pendingGeocode = null;
    state.currentGeocodingIndex++;
    processGeocodeQueue();
  }

  function skipCurrentGeocode() {
    const { item, queryAddress } = state.pendingGeocode;

    // Add as error
    state.geocodedResults.push({
      ...item,
      queryAddress,
      geocode: { success: false, error: 'Skipped' },
      error: true,
      skipped: true
    });

    elements.disambigModal.classList.add('hidden');
    elements.coordModal.classList.add('hidden');
    elements.loadingOverlay.classList.remove('hidden');
    state.pendingGeocode = null;
    state.currentGeocodingIndex++;
    processGeocodeQueue();
  }

  async function displayResults() {
    const successful = state.geocodedResults.filter(r => r.geocode.success);
    const failed = state.geocodedResults.filter(r => !r.geocode.success);

    // Update header
    elements.headerStats.textContent = `${successful.length} mapped${failed.length > 0 ? `, ${failed.length} failed` : ''}`;
    elements.locationCount.textContent = `${state.geocodedResults.length} locations`;

    // Render location list
    renderLocationList();

    // Initialize and display map
    if (successful.length > 0) {
      await initializeMap(successful);
    }
  }

  function renderLocationList() {
    elements.locationList.innerHTML = state.geocodedResults.map((loc, index) => {
      const isError = !loc.geocode.success;
      return `
        <div class="location-item ${isError ? 'error' : ''}" data-index="${index}">
          <div class="location-content">
            <span class="location-number">${index + 1}</span>
            <div class="location-details">
              <div class="location-address">${escapeHtml(loc.address)}</div>
              ${loc.geocode.success ? `
                <div class="location-formatted">${escapeHtml(loc.geocode.formattedAddress)}</div>
              ` : `
                <div class="location-error">${loc.skipped ? 'Skipped' : 'Could not geocode'}</div>
              `}
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Add click handlers to pan to location
    elements.locationList.querySelectorAll('.location-item').forEach(el => {
      el.addEventListener('click', () => {
        const index = parseInt(el.dataset.index);
        const loc = state.geocodedResults[index];

        if (loc.geocode.success && state.mapInstance) {
          state.mapInstance.setCenter(loc.geocode.lat, loc.geocode.lng, 16);

          // Highlight in list
          elements.locationList.querySelectorAll('.location-item').forEach(item => {
            item.classList.remove('active');
          });
          el.classList.add('active');
        }
      });
    });
  }

  async function initializeMap(locations) {
    try {
      state.mapInstance = await MapProviderFactory.create(
        state.mapProvider,
        elements.map,
        { apiKey: state.apiKey }
      );

      // Add markers
      locations.forEach((loc, index) => {
        const overallIndex = state.geocodedResults.indexOf(loc);
        const matchQuality = loc.geocode.manual ? 'Manual entry' :
          loc.geocode.partialMatch ? 'Approximate match' :
          loc.geocode.locationType === 'ROOFTOP' ? 'Exact match' : 'Approximate';

        state.mapInstance.addMarker(
          loc.geocode.lat,
          loc.geocode.lng,
          loc.address,
          {
            label: overallIndex + 1,
            formattedAddress: loc.geocode.formattedAddress,
            originalAddress: loc.address,
            matchQuality
          }
        );
      });

      // Fit bounds to show all markers
      state.mapInstance.fitBounds();

    } catch (error) {
      console.error('Map initialization error:', error);
      elements.map.innerHTML = `
        <div class="empty-state">
          <p>Failed to load map: ${error.message}</p>
        </div>
      `;
    }
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Start
  init();

})();
