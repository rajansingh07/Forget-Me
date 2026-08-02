const AUTO_CLEAN_ALARM = "forget-me-auto-clean";
const MAX_RECENT_ORIGINS = 100;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "cleanSite") {
    cleanSiteData(request.origin, request.options)
      .then(() => sendResponse({ success: true }))
      .catch((error) => {
        console.error("Error cleaning site data:", error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  if (request.action === "updateAutoCleanSchedule") {
    updateAutoCleanSchedule()
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === AUTO_CLEAN_ALARM) {
    runScheduledCleanup();
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.url?.startsWith("http")) {
    trackOrigin(new URL(tab.url).origin);
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") {
    return;
  }

  if (changes.autoClean || changes.frequency) {
    updateAutoCleanSchedule();
  }
});

async function updateAutoCleanSchedule() {
  const { autoClean, frequency } = await chrome.storage.local.get([
    "autoClean",
    "frequency",
  ]);

  await chrome.alarms.clear(AUTO_CLEAN_ALARM);

  if (!autoClean) {
    return;
  }

  const periodInMinutes = frequencyToMinutes(frequency || "Every Day");

  chrome.alarms.create(AUTO_CLEAN_ALARM, {
    periodInMinutes,
  });
}

function frequencyToMinutes(frequency) {
  switch (frequency) {
    case "Every Week":
      return 7 * 24 * 60;
    case "Every Month":
      return 30 * 24 * 60;
    case "Every Day":
    default:
      return 24 * 60;
  }
}

async function trackOrigin(origin) {
  const { recentOrigins = [] } = await chrome.storage.local.get([
    "recentOrigins",
  ]);
  const updated = [
    origin,
    ...recentOrigins.filter((item) => item !== origin),
  ].slice(0, MAX_RECENT_ORIGINS);

  await chrome.storage.local.set({ recentOrigins: updated });
}

async function runScheduledCleanup() {
  const { recentOrigins = [], cleanPreferences = {} } =
    await chrome.storage.local.get(["recentOrigins", "cleanPreferences"]);

  if (!recentOrigins.length) {
    return;
  }

  let cleanedCount = 0;

  for (const origin of recentOrigins) {
    try {
      await cleanSiteData(origin, cleanPreferences, { notify: false });
      cleanedCount += 1;
    } catch (error) {
      console.error(`Scheduled cleanup failed for ${origin}:`, error);
    }
  }

  await chrome.storage.local.set({ recentOrigins: [] });

  if (cleanedCount > 0) {
    showNotification(
      "Forget Me",
      `Auto cleanup finished for ${cleanedCount} site${cleanedCount === 1 ? "" : "s"}`,
    );
  }
}

async function cleanSiteData(origin, options = {}, { notify = true } = {}) {
  if (!origin) {
    throw new Error("No site origin provided");
  }

  const promises = [];
  const browsingDataTypes = {};

  if (options.cookies) {
    browsingDataTypes.cookies = true;
  }
  if (options.cache) {
    browsingDataTypes.cache = true;
    browsingDataTypes.cacheStorage = true;
    browsingDataTypes.serviceWorkers = true;
  }
  if (options.localStorage) {
    browsingDataTypes.localStorage = true;
    promises.push(clearPageStorage(origin));
  }
  if (options.indexedDB) {
    browsingDataTypes.indexedDB = true;
  }

  if (Object.keys(browsingDataTypes).length > 0) {
    promises.push(removeBrowsingData(origin, browsingDataTypes));
  }

  if (options.history) {
    promises.push(cleanHistory(origin));
  }

  await Promise.all(promises);

  if (notify) {
    const url = new URL(origin);
    showNotification("Forget Me", `Data cleared for ${url.hostname}`);
  }
}

function removeBrowsingData(origin, dataTypes) {
  return new Promise((resolve, reject) => {
    chrome.browsingData.remove({ origins: [origin] }, dataTypes, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
}

function clearPageStorage(origin) {
  return new Promise((resolve) => {
    chrome.tabs.query({ url: `${origin}/*` }, (tabs) => {
      if (chrome.runtime.lastError || !tabs.length) {
        resolve();
        return;
      }

      const messagePromises = tabs.map((tab) =>
        chrome.tabs
          .sendMessage(tab.id, { action: "clearLocalStorage" })
          .catch(() => null),
      );

      Promise.all(messagePromises).finally(resolve);
    });
  });
}

function cleanHistory(origin) {
  return new Promise((resolve, reject) => {
    chrome.history.search({ text: "", maxResults: 10000 }, (historyItems) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      const itemsToDelete = historyItems.filter((item) => {
        try {
          return new URL(item.url).origin === origin;
        } catch {
          return false;
        }
      });

      if (!itemsToDelete.length) {
        resolve();
        return;
      }

      const deletePromises = itemsToDelete.map(
        (item) =>
          new Promise((deleteResolve, deleteReject) => {
            chrome.history.deleteUrl({ url: item.url }, () => {
              if (chrome.runtime.lastError) {
                deleteReject(new Error(chrome.runtime.lastError.message));
              } else {
                deleteResolve();
              }
            });
          }),
      );

      Promise.all(deletePromises)
        .then(() => resolve())
        .catch(reject);
    });
  });
}

function showNotification(title, message) {
  chrome.notifications.create("", {
    type: "basic",
    iconUrl: "icons/icon48.png",
    title,
    message,
  });
}

chrome.runtime.onInstalled.addListener(async () => {
  console.log("Forget Me extension installed");

  const existing = await chrome.storage.local.get([
    "cleanPreferences",
    "showPrivacyScore",
  ]);

  if (!existing.cleanPreferences) {
    await chrome.storage.local.set({
      cleanPreferences: {
        cookies: true,
        cache: true,
        localStorage: true,
        history: true,
        indexedDB: true,
      },
    });
  }

  if (existing.showPrivacyScore === undefined) {
    await chrome.storage.local.set({ showPrivacyScore: true });
  }

  await updateAutoCleanSchedule();
});
