(function () {
  const placeholderKey = "YOUR_API_KEY";
  if (!window.GMAPS_API_KEY || window.GMAPS_API_KEY === placeholderKey) {
    window.GMAPS_API_KEY = placeholderKey;
  }

  if (window.GMAPS_API_KEY === AIzaSyCEjHTmqVn-72tx1XHcDatsLIRBW8Xeamw) {
    console.warn(
      "Update web/config.js with your Google Maps API key before deploying to production."
    );
  }
})();

// Replace "YOUR_API_KEY" with your Google Maps API key prior to publishing the site.
