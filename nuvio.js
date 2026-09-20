"use strict";

// This content script runs only on Nuvio. It never exposes the session to IMDb.
const SESSION_KEY = "nuvio.supabase.session";
let lastSession = null;
let lastProfile = null;
let invalidated = false;
let pollTimer = null;

function selectedProfile() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    const userId = JSON.parse(raw || "null")?.user?.id;
    if (!userId) return null;
    const id = Number(localStorage.getItem(`nuvio.profile.active.${userId}`));
    return Number.isInteger(id) && id > 0 ? id : null;
  } catch { return null; }
}

function sync() {
  if (invalidated) return;
  let session = null;
  try {
    const parsed = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    if (parsed?.access_token) {
      session = {
        access_token: parsed.access_token,
        refresh_token: parsed.refresh_token || null,
        expires_at: parsed.expires_at || 0
      };
    }
  } catch { /* The app may be updating localStorage. Retry on the next poll. */ }
  const signature = session ? `${session.access_token}:${session.expires_at}` : "signed-out";
  const profileId = selectedProfile();
  if (signature === lastSession && profileId === lastProfile) return;
  lastSession = signature;
  lastProfile = profileId;
  try {
    chrome.runtime.sendMessage({ type: "SYNC_SESSION", session, profileId }).catch(error => {
      if (!chrome.runtime?.id || /Extension context invalidated/i.test(String(error))) {
        invalidated = true;
        clearInterval(pollTimer);
        return;
      }
      lastSession = null;
      lastProfile = null;
    });
  } catch (error) {
    if (!chrome.runtime?.id || /Extension context invalidated/i.test(String(error))) {
      invalidated = true;
      clearInterval(pollTimer);
      return;
    }
    throw error;
  }
}

sync();
if (!invalidated) pollTimer = setInterval(sync, 5000);
window.addEventListener("storage", event => {
  if (event.key === SESSION_KEY || event.key?.startsWith("nuvio.profile.active.")) sync();
});
