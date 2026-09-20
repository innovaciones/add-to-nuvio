"use strict";

(() => {
  const ROW_ID = "nuvio-rt-row";
  const MENU_ID = "nuvio-rt-menu";
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
    const match = location.pathname.match(/^\/(m|tv)\/[^/]+\/?$/);
    if (!match) return null;
    const contentType = match[1] === "m" ? "movie" : "series";
    const section = document.querySelector('section[data-qa="section:where-to-watch"]') ||
      document.querySelector('section[aria-labelledby="where-to-watch-label"]');
    if (!section) return null;

    let details = {};
    try { details = JSON.parse(section.querySelector('#where-to-watch-json')?.textContent || "{}"); }
    catch { /* Use structured metadata below. */ }
    let ld = {};
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const parsed = JSON.parse(script.textContent);
        const nodes = Array.isArray(parsed) ? parsed : parsed?.["@graph"] || [parsed];
        ld = nodes.find(item => ["Movie", "TVSeries", "TVMiniSeries"].includes(item?.["@type"])) || {};
        if (ld["@type"]) break;
      } catch { /* Try the next JSON-LD block. */ }
    }
    const name = String(details.title || ld.name || document.querySelector("#media-hero-label")?.textContent || "").trim();
    if (!name) return null;
    const year = Number(String(details.releaseYear || ld.datePublished || "").match(/\d{4}/)?.[0]) || null;
    return {
      section, name, year, contentType,
      fallback: {
        name, year: year ? String(year) : null,
        poster: typeof ld.image === "string" ? ld.image :
          document.querySelector('meta[property="og:image"]')?.content || null,
        description: ld.description || null,
        genres: Array.isArray(ld.genre) ? ld.genre : ld.genre ? [ld.genre] : []
      }
    };
  }

  function icon(kind) {
    if (kind === "nuvio") {
      const image = document.createElement("img");
      image.src = ICON_URL;
      image.alt = "";
      image.className = "nuvio-rt-icon";
      image.setAttribute("aria-hidden", "true");
      return image;
    }
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "nuvio-rt-icon");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("fill", "currentColor");
    path.setAttribute("d", kind === "check" ?
      "M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" :
      "M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z");
    svg.append(path);
    if (kind === "spinner") svg.style.animation = "nuvio-rt-spin .8s linear infinite";
    return svg;
  }

  function toast(message, failed = false) {
    document.getElementById("nuvio-rt-toast")?.remove();
    const element = document.createElement("div");
    element.id = "nuvio-rt-toast";
    element.textContent = message;
    if (failed) element.classList.add("failed");
    const rect = document.getElementById(ROW_ID)?.getBoundingClientRect();
    element.style.top = `${Math.min(window.innerHeight - 60, rect ? rect.bottom + 8 : 100)}px`;
    element.style.left = `${Math.max(8, Math.min(window.innerWidth - 280, rect?.left || 8))}px`;
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
    main.className = "nuvio-rt-main";
    const lines = document.createElement("span");
    lines.className = "nuvio-rt-lines";
    const label = document.createElement("span");
    label.className = "nuvio-rt-label";
    const subtitle = document.createElement("span");
    subtitle.className = "nuvio-rt-subtitle";
    lines.append(label, subtitle);
    main.append(lines);
    const caret = document.createElement("button");
    caret.type = "button";
    caret.className = "nuvio-rt-profile";
    caret.textContent = "⌄";
    caret.setAttribute("aria-label", "Select Nuvio profile");
    row.append(main, caret);
    info.section.insertBefore(row, info.section.querySelector("where-to-watch-manager") || info.section.children[1] || null);

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
      main.querySelector(".nuvio-rt-icon")?.remove();
      main.insertBefore(icon(loading ? "spinner" : inLibrary ? "check" : "nuvio"), lines);
      label.textContent = loading ? (operation === "check" ? "Checking Nuvio..." :
        operation === "remove" ? "Removing..." : "Adding...") :
        lastError === RELOAD_MESSAGE ? "Reload page" :
        lastError ? "Error — retry" : !connected ? "Connect Nuvio" :
        inLibrary ? "In Nuvio" : "Add to Nuvio";
      subtitle.textContent = lastError === RELOAD_MESSAGE ? "Extension updated" :
        lastError || (connected ? profileName() : "Visit nuvio.tv to sync");
      main.title = lastError || "";
      main.disabled = loading || lastError === RELOAD_MESSAGE;
      caret.disabled = loading || !connected || lastError === RELOAD_MESSAGE;
      caret.hidden = !connected;
      main.setAttribute("aria-label", `${label.textContent} — ${lastError || subtitle.textContent}`);
    }

    async function refresh() {
      const current = ++sequence;
      loading = true;
      operation = "check";
      lastError = null;
      render();
      try {
        if (!imdbId) {
          const resolved = await send({ type: "RESOLVE_TITLE", name: info.name, year: info.year, contentType: info.contentType });
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
      const menuWidth = Math.min(210, window.innerWidth - 16);
      const menuHeight = Math.min(window.innerHeight - 16, 42 + profiles.length * 38);
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
