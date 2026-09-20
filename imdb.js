"use strict";

const NUVIO_ICON_URL = chrome.runtime.getURL("icons/nuvio.png");
const RELOAD_MESSAGE = "The extension was updated. Reload this tab.";

initialize();

async function send(message) {
  try {
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.ok) throw new Error(response?.error || "No response from the extension.");
    return response.result;
  } catch (error) {
    if (!chrome.runtime?.id || /Extension context invalidated/i.test(String(error))) {
      throw new Error(RELOAD_MESSAGE);
    }
    throw error;
  }
}

function titleInfo() {
  const imdbId = location.pathname.match(/\/title\/(tt\d+)/)?.[1];
  if (!imdbId) return null;
  let ld = {};
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(script.textContent);
      const nodes = Array.isArray(data) ? data : data?.["@graph"] || [data];
      ld = nodes.find(node => ["Movie", "TVSeries", "TVMiniSeries", "TVEpisode", "TVMovie"].includes(node?.["@type"])) || {};
      if (ld["@type"]) break;
    } catch { /* Try another JSON-LD block. */ }
  }
  const ogType = document.querySelector('meta[property="og:type"]')?.content;
  const type = ["Movie", "TVMovie"].includes(ld["@type"]) || ogType === "video.movie" ? "movie" :
    ["TVSeries", "TVMiniSeries"].includes(ld["@type"]) || ["video.tv_show", "video.tv_series"].includes(ogType) ? "series" : null;
  if (!type) return null;
  return {
    imdbId, contentType: type,
    fallback: {
      name: ld.name || document.querySelector('[data-testid="hero__primary-text"]')?.textContent?.trim() || "",
      poster: typeof ld.image === "string" ? ld.image : document.querySelector('meta[property="og:image"]')?.content || null,
      description: ld.description || null,
      year: ld.datePublished?.slice(0, 4) || null,
      rating: ld.aggregateRating?.ratingValue || null,
      genres: Array.isArray(ld.genre) ? ld.genre : ld.genre ? [ld.genre] : []
    }
  };
}

function svg(path) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  node.setAttribute("viewBox", "0 0 24 24");
  node.setAttribute("width", "24");
  node.setAttribute("height", "24");
  node.setAttribute("class", "ipc-btn__icon ipc-btn__icon--pre nuvio-action-icon");
  const shape = document.createElementNS("http://www.w3.org/2000/svg", "path");
  shape.setAttribute("d", path);
  shape.setAttribute("fill", "currentColor");
  node.append(shape);
  return node;
}

const ICON = {
  check: "M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z",
  spinner: "M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"
};

function nuvioIcon() {
  const img = document.createElement("img");
  img.className = "ipc-btn__icon ipc-btn__icon--pre nuvio-action-icon";
  img.src = NUVIO_ICON_URL;
  img.alt = "";
  img.setAttribute("aria-hidden", "true");
  return img;
}

function toast(text, failed = false) {
  document.getElementById("nuvio-toast")?.remove();
  const element = document.createElement("div");
  element.id = "nuvio-toast";
  element.classList.toggle("nuvio-toast-error", failed);
  element.setAttribute("role", failed ? "alert" : "status");
  const heading = document.createElement("div");
  heading.className = "heading";
  heading.textContent = "Nuvio";
  const message = document.createElement("div");
  message.className = "message";
  message.textContent = text;
  element.append(heading, message);
  document.body.append(element);
  const rect = document.getElementById("nuvio-split-button")?.getBoundingClientRect();
  const left = Math.max(8, Math.min(rect?.left ?? 8, window.innerWidth - element.offsetWidth - 8));
  const below = (rect?.bottom ?? 92) + 6;
  const top = below + element.offsetHeight <= window.innerHeight - 8
    ? below : Math.max(8, (rect?.top ?? window.innerHeight) - element.offsetHeight - 6);
  element.style.top = `${top}px`;
  element.style.left = `${left}px`;
  setTimeout(() => element.remove(), 4000);
}

function initialize() {
  let previousUrl = location.href;
  let attempts = 0;
  let timer = null;

  function schedule() {
    if (timer) return;
    timer = setTimeout(() => { timer = null; inject(); }, 500);
  }

  function inject() {
    const info = titleInfo();
    if (!info || document.getElementById("nuvio-split-button")) return;
    const watchlist = document.querySelector('[data-testid="tm-box-wl-button"]');
    const source = watchlist?.closest(".ipc-split-button");
    const ready = source && watchlist?.querySelectorAll(".ipc-btn__text > div").length >= 2 &&
      watchlist.getAttribute("aria-disabled") !== "true";
    if (!ready) {
      if (++attempts < 120) schedule();
      return;
    }
    attempts = 0;

    const wrapper = source.cloneNode(true);
    wrapper.id = "nuvio-split-button";
    const main = wrapper.querySelector("button:first-child");
    const caret = wrapper.querySelector("button:last-child");
    if (!main || !caret) return;
    main.removeAttribute("data-testid");
    main.removeAttribute("aria-pressed");
    main.setAttribute("aria-disabled", "false");
    caret.removeAttribute("data-testid");
    caret.setAttribute("aria-label", "Select Nuvio profile");
    const originalLines = watchlist.querySelectorAll(".ipc-btn__text > div");
    const text = document.createElement("div");
    text.className = "ipc-btn__text";
    const title = document.createElement("div");
    title.className = `${originalLines[0].className} nuvio-title`;
    const subtitle = document.createElement("div");
    subtitle.className = `${originalLines[1].className} nuvio-subtitle`;
    text.append(title, subtitle);
    main.replaceChildren(text);

    const menu = document.createElement("div");
    menu.id = "nuvio-profile-menu";
    document.body.append(menu);
    source.parentElement.insertBefore(wrapper, source.nextSibling);

    let connected = false;
    let inLibrary = false;
    let loading = false;
    let profileId = null;
    let profiles = [];
    let lastError = null;
    let checkSequence = 0;

    function profileName() {
      return profiles.find(p => p.id === profileId)?.name || (profileId ? `Profile ${profileId}` : "");
    }

    function render() {
      wrapper.classList.remove("nuvio-default", "nuvio-added", "nuvio-loading", "nuvio-error", "nuvio-disconnected");
      const state = loading ? "nuvio-loading" : lastError ? "nuvio-error" : !connected ? "nuvio-disconnected" : inLibrary ? "nuvio-added" : "nuvio-default";
      wrapper.classList.add(state);
      const icon = loading ? svg(ICON.spinner) : inLibrary ? svg(ICON.check) : nuvioIcon();
      if (loading) icon.style.animation = "nuvio-spin .8s linear infinite";
      main.querySelector(".nuvio-action-icon")?.remove();
      main.insertBefore(icon, text);
      title.textContent = loading ? (!connected ? "Checking..." : inLibrary ? "Removing..." : "Adding...") : lastError === RELOAD_MESSAGE ? "Reload page" : lastError ? "Error — retry" : !connected ? "Connect Nuvio" : inLibrary ? "In Nuvio" : "Add to Nuvio";
      subtitle.textContent = connected ? profileName() : "Visit nuvio.tv to sync";
      main.setAttribute("aria-label", `${title.textContent} — ${subtitle.textContent}`);
      main.disabled = loading;
      caret.disabled = loading || !connected;
      caret.style.display = connected ? "" : "none";
    }

    async function refresh() {
      const sequence = ++checkSequence;
      loading = true;
      lastError = null;
      render();
      try {
        const state = await send({ type: "GET_STATE", imdbId: info.imdbId, contentType: info.contentType });
        if (sequence !== checkSequence || !wrapper.isConnected) return;
        connected = state.connected;
        inLibrary = state.inLibrary;
        profileId = state.profileId;
        profiles = state.profiles || [];
      } catch (error) {
        if (sequence !== checkSequence || !wrapper.isConnected) return;
        lastError = error.message;
        toast(error.message, true);
      } finally {
        if (sequence === checkSequence && wrapper.isConnected) { loading = false; render(); }
      }
    }

    main.addEventListener("click", async event => {
      if (!event.isTrusted || loading) return;
      if (!connected) { window.open("https://nuvio.tv/", "_blank", "noopener"); return; }
      ++checkSequence;
      const removing = inLibrary;
      loading = true;
      lastError = null;
      render();
      try {
        const result = await send({
          type: removing ? "REMOVE" : "ADD", imdbId: info.imdbId,
          contentType: info.contentType, fallback: info.fallback
        });
        inLibrary = result.inLibrary;
        toast(removing ? "Removed from Nuvio." : "Added to Nuvio.");
      } catch (error) {
        lastError = error.message;
        toast(error.message, true);
      } finally { loading = false; render(); }
    });

    caret.addEventListener("click", event => {
      event.stopPropagation();
      if (loading || !connected) return;
      menu.replaceChildren();
      const heading = document.createElement("div");
      heading.className = "heading";
      heading.textContent = "Nuvio profile";
      menu.append(heading);
      for (const profile of profiles) {
        const option = document.createElement("button");
        option.type = "button";
        option.className = profile.id === profileId ? "active" : "";
        option.setAttribute("aria-pressed", String(profile.id === profileId));
        option.textContent = profile.name;
        option.addEventListener("click", async () => {
          menu.classList.remove("open");
          try {
            await send({ type: "SELECT_PROFILE", profileId: profile.id });
            await refresh();
          } catch (error) { toast(error.message, true); }
        });
        menu.append(option);
      }
      if (menu.classList.contains("open")) {
        menu.classList.remove("open");
        return;
      }
      menu.classList.add("open");
      const rect = caret.getBoundingClientRect();
      const left = Math.max(8, Math.min(rect.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8));
      const below = rect.bottom + 6;
      const top = below + menu.offsetHeight <= window.innerHeight - 8
        ? below : Math.max(8, rect.top - menu.offsetHeight - 6);
      menu.style.top = `${top}px`;
      menu.style.left = `${left}px`;
    });

    document.addEventListener("click", event => {
      if (!menu.contains(event.target)) menu.classList.remove("open");
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && wrapper.isConnected) refresh();
    });
    render();
    refresh();
  }

  const observer = new MutationObserver(() => {
    if (location.href !== previousUrl) {
      previousUrl = location.href;
      document.getElementById("nuvio-split-button")?.remove();
      document.getElementById("nuvio-profile-menu")?.remove();
      attempts = 0;
      schedule();
    } else if (/\/title\/tt\d+/.test(location.pathname) &&
      !document.getElementById("nuvio-split-button") && attempts < 120) {
      schedule();
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  inject();
}
