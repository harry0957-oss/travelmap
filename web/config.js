(function () {
  const placeholderKey = AIzaSyCEjHTmqVn-72tx1XHcDatsLIRBW8Xeamw;
  const configuredKey =
    typeof window.GMAPS_API_KEY === "string" ? window.GMAPS_API_KEY.trim() : "";

  if (configuredKey && configuredKey !== placeholderKey) {
    window.GMAPS_API_KEY = configuredKey;
    return;
  }

  console.warn(
    "Google Maps API key is not configured. Update web/.env or web/config.js before deploying."
  );
  window.GMAPS_API_KEY = placeholderKey;
})();

// Replace "YOUR_API_KEY" with your Google Maps API key prior to publishing the site.
