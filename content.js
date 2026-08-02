const TRACKER_PATTERNS = [
  "google-analytics.com",
  "googletagmanager.com",
  "doubleclick.net",
  "adservice.google",
  "googleadservices.com",
  "googlesyndication.com",
  "facebook.net",
  "connect.facebook.net",
  "pixel.facebook.com",
  "tiktok.com",
  "analytics.tiktok.com",
  "snapchat.com",
  "sc-static.net",
  "linkedin.com",
  "licdn.com",
  "pinterest.com",
  "hotjar.com",
  "static.hotjar.com",
  "segment.io",
  "segment.com",
  "mixpanel.com",
  "amplitude.com",
  "heap.io",
  "fullstory.com",
  "logrocket.com",
  "clarity.ms",
  "mouseflow.com",
  "crazyegg.com",
  "adsrvr.org",
  "adnxs.com",
  "criteo.com",
  "taboola.com",
  "outbrain.com",
  "mgid.com",
  "amazon-adsystem.com",
  "advertising.com",
  "scorecardresearch.com",
  "quantserve.com",
  "newrelic.com",
  "bugsnag.com",
  "sentry.io",
  "rollbar.com",
  "mailchimp.com",
  "hubspot.com",
  "hs-scripts.com",
  "intercom.io",
  "intercomcdn.com",
  "drift.com",
  "marketo.com",
  "sessioncam.com",
  "inspectlet.com",
  "luckyorange.com",
  "smartlook.com",
  "impact.com",
  "shareasale.com",
  "rakuten.com",
  "cj.com",
  "cdn.segment.com",
  "bat.bing.com",
  "clarity.microsoft.com",
  "ads.yahoo.com",
];

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "clearLocalStorage") {
    try {
      localStorage.clear();
      sessionStorage.clear();
      sendResponse({ success: true });
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
    return true;
  }

  if (request.action === "scanTrackers") {
    sendResponse({ count: countTrackers() });
    return true;
  }
});

function countTrackers() {
  const found = new Set();

  document
    .querySelectorAll("script[src], iframe[src], img[src]")
    .forEach((element) => {
      const src = element.getAttribute("src");
      if (!src) {
        return;
      }

      try {
        const hostname = new URL(src, window.location.href).hostname;
        if (TRACKER_PATTERNS.some((pattern) => hostname.includes(pattern))) {
          found.add(hostname);
        }
      } catch {
        // Ignore invalid URLs
      }
    });

  return found.size;
}

function scanAndReportTrackers() {
  chrome.storage.local.get(["detectTrackers"], (result) => {
    if (!result.detectTrackers) {
      return;
    }

    const count = countTrackers();
    chrome.storage.local.set({ trackerCount: count });
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", scanAndReportTrackers);
} else {
  scanAndReportTrackers();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.detectTrackers) {
    if (changes.detectTrackers.newValue) {
      scanAndReportTrackers();
    } else {
      chrome.storage.local.set({ trackerCount: 0 });
    }
  }
});
