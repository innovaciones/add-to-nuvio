"use strict";

(() => {
  const ROW_ID = "nuvio-tmdb-row";
  const MENU_ID = "nuvio-tmdb-menu";
  const ICON_URL = chrome.runtime.getURL("icons/nuvio.png");
  const RELOAD_MESSAGE = "The extension was updated. Reload this tab.";
  let lastUrl = location.href;
  let scheduled = false;

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
    const match = location.pathname.match(/^\/(movie|tv)\/(\d+)(?:-[^/]+)?\/?$/);
    if (!match) return null;
    const posterWrapper = document.querySelector("#original_header .poster_wrapper");
    const poster = posterWrapper?.querySelector(".poster img.poster");
    if (!posterWrapper || !poster) return null;
    const contentType = match[1] === "movie" ? "movie" : "series";
    const name = document.querySelector("#original_header .title h2 a")?.textContent?.trim() ||
      document.querySelector('meta[property="og:title"]')?.content || "";
    const year = document.querySelector("#original_header .title .release_date")?.textContent?.match(/\d{4}/)?.[0] || null;
    return {
      tmdbId: match[2], contentType, posterWrapper,
      fallback: {
        name, year,
        poster: poster.src || null,
        description: document.querySelector("#original_header .overview")?.textContent?.trim() || null,
        genres: [...document.querySelectorAll("#original_header .facts .genres a")].map(a => a.textContent.trim())
      }
    };
  }

  function icon(kind) {
    if (kind === "nuvio") {
      const image = document.createElement("img");
      image.src = ICON_URL;
      image.alt = "";
      image.className = "nuvio-tmdb-icon";
      image.setAttribute("aria-hidden", "true");
      return image;
    }
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "nuvio-tmdb-icon");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("fill", "currentColor");
    path.setAttribute("d", kind === "check" ?
      "M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" :
      "M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z");
    svg.append(path);
    if (kind === "spinner") svg.style.animation = "nuvio-tmdb-spin .8s linear infinite";
    return svg;
  }

  function toast(message, failed = false) {
    document.getElementById("nuvio-tmdb-toast")?.remove();
    const element = document.createElement("div");
    element.id = "nuvio-tmdb-toast";
    element.textContent = message;
    if (failed) element.classList.add("failed");
    const rect = document.getElementById(ROW_ID)?.getBoundingClientRect();
    element.style.top = `${Math.max(8, Math.min(window.innerHeight - 60, rect ? rect.bottom + 8 : 100))}px`;
    element.style.left = `${Math.max(8, Math.min(window.innerWidth - 288, rect?.left || 8))}px`;
    document.body.append(element);
    setTimeout(() => element.remove(), 4000);
  }

  function inject() {
    if (document.getElementById(ROW_ID)) return;
    const info = titleInfo();
    if (!info) return;

    const row = document.createElement("div");
    row.id = ROW_ID;
    const main = document.createElement("button");
    main.type = "button";
    main.className = "nuvio-tmdb-main";
    const lines = document.createElement("span");
    lines.className = "nuvio-tmdb-lines";
    const label = document.createElement("span");
    label.className = "nuvio-tmdb-label";
    const subtitle = document.createElement("span");
    subtitle.className = "nuvio-tmdb-subtitle";
    lines.append(label, subtitle);
    main.append(lines);
    const caret = document.createElement("button");
    caret.type = "button";
    caret.className = "nuvio-tmdb-profile";
    caret.textContent = "⌄";
    caret.setAttribute("aria-label", "Select Nuvio profile");
    row.append(main, caret);
    info.posterWrapper.append(row);

    const menu = document.createElement("div");
    menu.id = MENU_ID;
    document.body.append(menu);

    let imdbId = null;
    let connected = false;
    let inLibrary = false;
    let loading = false;
    let operation = "check";
    let profileId = null;
    let profiles = [];
    let lastError = null;
    let sequence = 0;

    function profileName() {
      return profiles.find(p => p.id === profileId)?.name ||
        (profileId ? `Profile ${profileId}` : "");
    }

    function render() {
      row.classList.toggle("nuvio-added", connected && inLibrary && !lastError);
      row.classList.toggle("nuvio-loading", loading);
      row.classList.toggle("nuvio-error", Boolean(lastError));
      main.querySelector(".nuvio-tmdb-icon")?.remove();
      main.insertBefore(icon(loading ? "spinner" : inLibrary ? "check" : "nuvio"), lines);
      label.textContent = loading ? (operation === "check" ? "Checking Nuvio..." :
        operation === "remove" ? "Removing..." : "Adding...") :
        lastError === RELOAD_MESSAGE ? "Reload page" :
        lastError ? "Error — retry" : !connected ? "Connect Nuvio" :
        inLibrary ? "In Nuvio" : "Add to Nuvio";
      subtitle.textContent = lastError || (connected ? profileName() : "Visit nuvio.tv to sync");
      main.title = lastError || "";
      main.disabled = loading || lastError === RELOAD_MESSAGE;
      caret.disabled = loading || !connected || lastError === RELOAD_MESSAGE;
      caret.hidden = !connected;
      main.setAttribute("aria-label", `${label.textContent} — ${subtitle.textContent}`);
    }

    async function refresh() {
      const current = ++sequence;
      loading = true;
      operation = "check";
      lastError = null;
      render();
      try {
        if (!imdbId) {
          const resolved = await send({ type: "RESOLVE_TMDB", tmdbId: info.tmdbId, contentType: info.contentType });
          imdbId = resolved.imdbId;
        }
        const state = await send({ type: "GET_STATE", imdbId, contentType: info.contentType });
        if (current !== sequence || !row.isConnected) return;
        connected = state.connected;
        inLibrary = state.inLibrary;
        profileId = state.profileId;
        profiles = state.profiles || [];
      } catch (error) {
        if (current !== sequence || !row.isConnected) return;
        lastError = error.message;
        toast(error.message, true);
      } finally {
        if (current === sequence && row.isConnected) { loading = false; render(); }
      }
    }

    main.addEventListener("click", async event => {
      if (!event.isTrusted || loading) return;
      if (lastError) { refresh(); return; }
      if (!connected) { window.open("https://nuvio.tv/", "_blank", "noopener"); return; }
      ++sequence;
      const removing = inLibrary;
      loading = true;
      operation = removing ? "remove" : "add";
      lastError = null;
      render();
      try {
        const result = await send({
          type: removing ? "REMOVE" : "ADD", imdbId,
          contentType: info.contentType, fallback: info.fallback
        });
        if (!row.isConnected) return;
        inLibrary = result.inLibrary;
        toast(removing ? "Removed from Nuvio." : "Added to Nuvio.");
      } catch (error) {
        if (!row.isConnected) return;
        lastError = error.message;
        toast(error.message, true);
      } finally { if (row.isConnected) { loading = false; render(); } }
    });

    caret.addEventListener("click", event => {
      event.stopPropagation();
      if (loading || !connected) return;
      const opening = !menu.classList.contains("open");
      menu.replaceChildren();
      const heading = document.createElement("div");
      heading.className = "heading";
      heading.textContent = "Nuvio profile";
      menu.append(heading);
      for (const profile of profiles) {
        const choice = document.createElement("button");
        choice.type = "button";
        choice.className = profile.id === profileId ? "active" : "";
        choice.textContent = profile.name;
        choice.addEventListener("click", async () => {
          menu.classList.remove("open");
          try {
            await send({ type: "SELECT_PROFILE", profileId: profile.id });
            await refresh();
          } catch (error) { toast(error.message, true); }
        });
        menu.append(choice);
      }
      const rect = caret.getBoundingClientRect();
      const menuWidth = Math.min(220, window.innerWidth - 16);
      const menuHeight = Math.min(window.innerHeight - 16, 44 + profiles.length * 38);
      menu.style.left = `${Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8))}px`;
      menu.style.top = `${Math.max(8, rect.bottom + menuHeight + 8 > window.innerHeight ? rect.top - menuHeight - 4 : rect.bottom + 4)}px`;
      menu.classList.toggle("open", opening);
    });

    document.addEventListener("click", event => {
      if (!menu.contains(event.target) && event.target !== caret) menu.classList.remove("open");
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && row.isConnected && lastError !== RELOAD_MESSAGE) refresh();
    });
    render();
    refresh();
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => { scheduled = false; inject(); }, 250);
  }

  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      document.getElementById(ROW_ID)?.remove();
      document.getElementById(MENU_ID)?.remove();
      schedule();
    } else if (!document.getElementById(ROW_ID)) schedule();
  }).observe(document.documentElement, { childList: true, subtree: true });
  inject();
})();
