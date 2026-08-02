const CLEAN_OPTION_IDS = [
  "cookies",
  "cache",
  "localStorage",
  "history",
  "indexedDB",
];

const DEFAULT_CLEAN_PREFERENCES = {
  cookies: true,
  cache: true,
  localStorage: true,
  history: true,
  indexedDB: true,
};

const FREQUENCY_LABELS = {
  "Every Day": "Runs every day",
  "Every Week": "Runs every week",
  "Every Month": "Runs every month",
};

document.addEventListener("DOMContentLoaded", () => {
  getCurrentTab();
  loadAllSettings();
  loadCleanupSummary();
  scanCurrentPageTrackers();

  document.getElementById("clean-btn").addEventListener("click", cleanCurrentSite);
  document.getElementById("settings-btn").addEventListener("click", showSettingsView);
  document.getElementById("back-btn").addEventListener("click", showMainView);
  document.getElementById("save-settings-btn").addEventListener("click", saveSettings);

  document.getElementById("quick-clean")?.addEventListener("click", quickClean);
  document.getElementById("deep-clean")?.addEventListener("click", deepClean);

  document
    .getElementById("auto-clean-toggle")
    ?.addEventListener("change", onMainAutoCleanToggle);
});

function showSettingsView() {
  document.getElementById("main-view").classList.add("hidden");
  document.getElementById("settings-view").classList.remove("hidden");
  loadSettingsForm();
}

function showMainView() {
  document.getElementById("settings-view").classList.add("hidden");
  document.getElementById("main-view").classList.remove("hidden");
  updatePrivacyScoreUI();
  updateAutoCleanStatusText();
}

function getCurrentTab(callback) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const urlElement = document.getElementById("current-url");

    if (!tabs[0]?.url) {
      urlElement.textContent = "Unavailable";
      callback?.(null);
      return;
    }

    try {
      const url = new URL(tabs[0].url);

      if (!url.protocol.startsWith("http")) {
        urlElement.textContent = "Not a website";
        callback?.(null);
        return;
      }

      urlElement.textContent = url.hostname;
      callback?.(tabs[0]);
    } catch {
      urlElement.textContent = "Invalid URL";
      callback?.(null);
    }
  });
}

function loadAllSettings() {
  chrome.storage.local.get(
    ["cleanPreferences", "autoClean", "frequency", "showPrivacyScore", "detectTrackers", "trackerCount"],
    (result) => {
      syncAutoCleanToggle(result.autoClean);
      updateAutoCleanStatusText(result.autoClean, result.frequency);
      updatePrivacyScoreUI(result);
      loadSettingsForm(result);
    },
  );
}

function loadSettingsForm(cached = null) {
  const apply = (result) => {
    document.getElementById("setting-auto-clean").checked = result.autoClean || false;
    document.getElementById("setting-frequency").value = result.frequency || "Every Day";
    document.getElementById("setting-show-privacy-score").checked =
      result.showPrivacyScore !== false;
    document.getElementById("setting-detect-trackers").checked =
      result.detectTrackers || false;

    const prefs = { ...DEFAULT_CLEAN_PREFERENCES, ...result.cleanPreferences };
    CLEAN_OPTION_IDS.forEach((id) => {
      const checkbox = document.getElementById(id);
      if (checkbox) {
        checkbox.checked = prefs[id];
      }
    });
  };

  if (cached) {
    apply(cached);
    return;
  }

  chrome.storage.local.get(
    ["autoClean", "frequency", "cleanPreferences", "showPrivacyScore", "detectTrackers"],
    apply,
  );
}

function getCleanPreferencesFromForm() {
  const cleanPreferences = {};

  CLEAN_OPTION_IDS.forEach((id) => {
    cleanPreferences[id] = document.getElementById(id).checked;
  });

  return cleanPreferences;
}

function saveSettings() {
  const cleanPreferences = getCleanPreferencesFromForm();

  const settings = {
    autoClean: document.getElementById("setting-auto-clean").checked,
    frequency: document.getElementById("setting-frequency").value,
    showPrivacyScore: document.getElementById("setting-show-privacy-score").checked,
    detectTrackers: document.getElementById("setting-detect-trackers").checked,
    cleanPreferences,
  };

  chrome.storage.local.set(settings, () => {
    const status = document.getElementById("settings-status");
    if (chrome.runtime.lastError) {
      status.textContent = "Failed to save settings";
      status.className = "settings-status error";
    } else {
      status.textContent = "Settings saved";
      status.className = "settings-status success";
      syncAutoCleanToggle(settings.autoClean);
      updateAutoCleanStatusText(settings.autoClean, settings.frequency);
      updatePrivacyScoreUI(settings);
      chrome.runtime.sendMessage({ action: "updateAutoCleanSchedule" });
    }

    setTimeout(() => {
      status.textContent = "";
      status.className = "settings-status";
    }, 2000);
  });
}

function onMainAutoCleanToggle(event) {
  const enabled = event.target.checked;

  chrome.storage.local.get(["frequency"], (result) => {
    chrome.storage.local.set({ autoClean: enabled }, () => {
      document.getElementById("setting-auto-clean").checked = enabled;
      updateAutoCleanStatusText(enabled, result.frequency);
      chrome.runtime.sendMessage({ action: "updateAutoCleanSchedule" });
    });
  });
}

function syncAutoCleanToggle(enabled) {
  const toggle = document.getElementById("auto-clean-toggle");
  if (toggle) {
    toggle.checked = enabled || false;
  }
}

function updateAutoCleanStatusText(autoClean, frequency) {
  const textEl = document.getElementById("auto-clean-status-text");
  if (!textEl) {
    return;
  }

  if (autoClean === undefined || frequency === undefined) {
    chrome.storage.local.get(["autoClean", "frequency"], (result) => {
      updateAutoCleanStatusText(result.autoClean, result.frequency);
    });
    return;
  }

  if (autoClean) {
    textEl.textContent = `Enabled — ${FREQUENCY_LABELS[frequency] || "Scheduled cleanup active"}`;
  } else {
    textEl.textContent = "Disabled — enable in Settings or use the toggle above";
  }
}

function updatePrivacyScoreUI(data) {
  if (!data) {
    chrome.storage.local.get(
      ["cleanPreferences", "showPrivacyScore", "detectTrackers", "trackerCount"],
      updatePrivacyScoreUI,
    );
    return;
  }

  const section = document.getElementById("privacy-score-section");
  const scoreEl = document.getElementById("privacy-score");
  const trackerInfo = document.getElementById("tracker-info");
  const showScore = data.showPrivacyScore !== false;

  section.classList.toggle("hidden", !showScore);

  if (!showScore) {
    return;
  }

  const prefs = { ...DEFAULT_CLEAN_PREFERENCES, ...data.cleanPreferences };
  let score = 100;

  CLEAN_OPTION_IDS.forEach((id) => {
    if (!prefs[id]) {
      score -= 12;
    }
  });

  if (data.detectTrackers && data.trackerCount > 0) {
    score -= Math.min(data.trackerCount * 8, 40);
  }

  score = Math.max(0, Math.min(100, score));
  scoreEl.textContent = `${score}%`;

  const level = score >= 80 ? "good" : score >= 50 ? "medium" : "low";
  scoreEl.dataset.level = level;
  section.querySelector(".score-ring")?.classList.remove("good", "medium", "low");
  section.querySelector(".score-ring")?.classList.add(level);

  if (data.detectTrackers) {
    const count = data.trackerCount || 0;
    trackerInfo.textContent =
      count > 0
        ? `${count} potential tracker${count === 1 ? "" : "s"} detected on this page`
        : "No trackers detected on this page";
    trackerInfo.classList.remove("hidden");
  } else {
    trackerInfo.classList.add("hidden");
  }
}

function getStoredCleanOptions(callback) {
  chrome.storage.local.get(["cleanPreferences"], (result) => {
    callback({ ...DEFAULT_CLEAN_PREFERENCES, ...result.cleanPreferences });
  });
}

function cleanCurrentSite() {
  const button = document.getElementById("clean-btn");
  const status = document.getElementById("status");

  button.disabled = true;
  button.textContent = "Cleaning...";

  getCurrentTab((tab) => {
    if (!tab) {
      status.textContent = "Cannot clean this page";
      button.disabled = false;
      button.textContent = "Clean Now";
      return;
    }

    getStoredCleanOptions((options) => {
      runCleanRequest(new URL(tab.url).origin, options, status, button);
    });
  });
}

function quickClean() {
  runCleanWithPreset({
    cookies: true,
    cache: true,
    localStorage: false,
    history: false,
    indexedDB: false,
  });
}

function deepClean() {
  runCleanWithPreset({
    cookies: true,
    cache: true,
    history: true,
    localStorage: true,
    indexedDB: true,
  });
}

function runCleanWithPreset(options) {
  const status = document.getElementById("status");
  const button = document.getElementById("clean-btn");

  getCurrentTab((tab) => {
    if (!tab) {
      status.textContent = "Cannot clean this page";
      return;
    }

    runCleanRequest(new URL(tab.url).origin, options, status, button);
  });
}

function runCleanRequest(origin, options, status, button) {
  chrome.runtime.sendMessage(
    {
      action: "cleanSite",
      origin,
      options,
    },
    (response) => {
      if (chrome.runtime.lastError) {
        status.textContent = "Cleaning failed";
      } else if (response?.success) {
        status.textContent = "Cleaned successfully";
        saveCleanupSummary(options);
        chrome.storage.local.set({ trackerCount: 0 });
        updatePrivacyScoreUI();
      } else {
        status.textContent = "Cleaning failed";
      }

      if (button) {
        button.disabled = false;
        button.textContent = "Clean Now";
      }

      setTimeout(() => {
        status.textContent = "";
      }, 3000);
    },
  );
}

function saveCleanupSummary(options) {
  chrome.storage.local.set({
    lastCleanup: {
      cookies: options.cookies ? "Cleaned" : "Skipped",
      cache: options.cache ? "Cleaned" : "Skipped",
      time: new Date().toLocaleString(),
    },
  });
}

function loadCleanupSummary() {
  chrome.storage.local.get(["lastCleanup"], (result) => {
    if (!result.lastCleanup) {
      return;
    }

    document.getElementById("cookie-count").textContent = result.lastCleanup.cookies;
    document.getElementById("cache-size").textContent =
      result.lastCleanup.cache || "0 MB";
    document.getElementById("last-clean").textContent = result.lastCleanup.time;
  });
}

function scanCurrentPageTrackers() {
  chrome.storage.local.get(["detectTrackers"], (result) => {
    if (!result.detectTrackers) {
      return;
    }

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab?.id || !tab.url?.startsWith("http")) {
        return;
      }

      chrome.tabs.sendMessage(tab.id, { action: "scanTrackers" }, (response) => {
        if (chrome.runtime.lastError || !response) {
          return;
        }

        chrome.storage.local.set({ trackerCount: response.count || 0 }, updatePrivacyScoreUI);
      });
    });
  });
}
