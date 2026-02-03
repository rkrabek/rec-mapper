/**
 * Background Service Worker - Coordinates communication between tabs and popup
 */

// Store for active tab state
const tabStates = new Map();

// Handle messages from content scripts and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  switch (message.action) {
    case 'contentScriptReady':
      if (tabId) {
        tabStates.set(tabId, {
          ready: true,
          isSelectionMode: false,
          addresses: []
        });
      }
      break;

    case 'selectionCancelled':
      if (tabId) {
        const state = tabStates.get(tabId) || {};
        state.isSelectionMode = false;
        tabStates.set(tabId, state);
      }
      // Forward to popup if open
      chrome.runtime.sendMessage({ action: 'selectionCancelled' }).catch(() => {});
      break;

    case 'matchesFound':
      if (tabId) {
        const state = tabStates.get(tabId) || {};
        state.matchCount = message.count;
        state.confidence = message.confidence;
        tabStates.set(tabId, state);
      }
      // Forward to popup
      chrome.runtime.sendMessage({
        action: 'matchesFound',
        count: message.count,
        confidence: message.confidence,
        selector: message.selector
      }).catch(() => {});
      break;

    case 'addressesExtracted':
      if (tabId) {
        const state = tabStates.get(tabId) || {};
        state.addresses = message.addresses;
        state.pageUrl = message.pageUrl;
        state.pageTitle = message.pageTitle;
        state.isSelectionMode = false;
        tabStates.set(tabId, state);
      }
      // Forward to popup
      chrome.runtime.sendMessage({
        action: 'addressesExtracted',
        addresses: message.addresses,
        pageUrl: message.pageUrl,
        pageTitle: message.pageTitle
      }).catch(() => {});
      break;

    case 'getTabState':
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          const state = tabStates.get(tabs[0].id) || { ready: false };
          sendResponse(state);
        } else {
          sendResponse({ ready: false });
        }
      });
      return true; // Keep channel open for async response

    case 'geocodeAddress':
      geocodeAddress(message.address, message.apiKey)
        .then(result => sendResponse(result))
        .catch(error => sendResponse({ error: error.message }));
      return true;

    case 'geocodeBatch':
      geocodeBatch(message.addresses, message.apiKey)
        .then(results => sendResponse(results))
        .catch(error => sendResponse({ error: error.message }));
      return true;
  }
});

// Geocoding function with caching
async function geocodeAddress(address, apiKey) {
  // Check cache first
  const cacheKey = `geocode_${btoa(address)}`;
  const cached = await chrome.storage.local.get(cacheKey);

  if (cached[cacheKey]) {
    return cached[cacheKey];
  }

  // Make API request
  const encodedAddress = encodeURIComponent(address);
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodedAddress}&key=${apiKey}`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (data.status === 'OK' && data.results.length > 0) {
      const firstResult = data.results[0];
      const result = {
        success: true,
        lat: firstResult.geometry.location.lat,
        lng: firstResult.geometry.location.lng,
        formattedAddress: firstResult.formatted_address,
        placeId: firstResult.place_id,
        // Include match quality info from Google
        partialMatch: firstResult.partial_match || false,
        locationType: firstResult.geometry.location_type, // ROOFTOP, RANGE_INTERPOLATED, GEOMETRIC_CENTER, APPROXIMATE
        types: firstResult.types // e.g., ['street_address'], ['establishment'], ['locality']
      };

      // Cache the result
      await chrome.storage.local.set({ [cacheKey]: result });

      return result;
    } else if (data.status === 'ZERO_RESULTS') {
      return { success: false, error: 'Address not found' };
    } else if (data.status === 'OVER_QUERY_LIMIT') {
      return { success: false, error: 'API rate limit exceeded', retryable: true };
    } else {
      return { success: false, error: data.status };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Batch geocoding with rate limiting
async function geocodeBatch(addresses, apiKey) {
  const results = [];
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

  for (let i = 0; i < addresses.length; i++) {
    const result = await geocodeAddress(addresses[i].address, apiKey);
    results.push({
      ...addresses[i],
      geocode: result
    });

    // Rate limit: max 50 requests per second for Google Maps API
    // We'll be conservative and do 10 per second
    if (i < addresses.length - 1) {
      await delay(100);
    }

    // If we hit rate limit, wait longer
    if (result.retryable) {
      await delay(2000);
      // Retry once
      const retry = await geocodeAddress(addresses[i].address, apiKey);
      results[results.length - 1].geocode = retry;
    }
  }

  return results;
}

// Clean up tab state when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  tabStates.delete(tabId);
});

// Handle extension icon click when popup is disabled
chrome.action.onClicked.addListener((tab) => {
  // This is a fallback if popup somehow fails to load
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    function: () => {
      alert('Rec Mapper: Please click the extension icon to open the popup.');
    }
  });
});
