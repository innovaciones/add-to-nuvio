"use strict";

(() => {
  const ROW_ID = "nuvio-letterboxd-row";
  const MENU_ID = "nuvio-letterboxd-menu";
  const NUVIO_ICON_URL = chrome.runtime.getURL("icons/nuvio.png");
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

  function metadata() {
    if (!/^\/film\/[^/]+\/?$/.test(location.pathname)) return null;
    const link = document.querySelector('a[href*="imdb.com/title/tt"]');
    const imdbId = link?.href.match(/imdb\.com\/title\/(tt\d+)/)?.[1];
    if (!imdbId) return null;

    let ld = {};
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      const source = script.textContent || "";
      const start = source.indexOf("{");
      const end = source.lastIndexOf("}");
      if (start < 0 || end <= start) continue;
      try {
        const data = JSON.parse(source.slice(start, end + 1));
        ld = Array.isArray(data) ? data.find(item => item?.["@type"]) || {} : data;
        if (ld["@type"]) break;
      } catch { /* Letterboxd can wrap JSON-LD in CDATA comments. */ }
    }

    const contentType = ["TVSeries", "TVMiniSeries"].includes(ld["@type"]) ? "series" : "movie";
    const heading = document.querySelector(".film-title-wrapper h1") ||
      document.querySelector("h1.headline-1");
    const pageTitle = document.querySelector('meta[property="og:title"]')?.content || "";
    return {
      imdbId, contentType,
      fallback: {
        name: ld.name || heading?.textContent?.trim() || pageTitle.replace(/\s*\(\d{4}\).*$/, ""),
        poster: typeof ld.image === "string" ? ld.image :
          document.querySelector('meta[property="og:image"]')?.content || null,
        description: ld.description || document.querySelector('meta[name="description"]')?.content || null,
        year: String(ld.datePublished || "").match(/\d{4}/)?.[0] ||
          document.querySelector(".film-title-wrapper .releasedate")?.textContent?.match(/\d{4}/)?.[0] || null,
        rating: ld.aggregateRating?.ratingValue || null,
        genres: Array.isArray(ld.genre) ? ld.genre : ld.genre ? [ld.genre] : []
      }
    };
  }

  function icon(kind) {
    if (kind === "nuvio") {
      const image = document.createElement("img");
      image.src = NUVIO_ICON_URL;
      image.alt = "";
      image.className = "nuvio-icon";
      image.setAttribute("aria-hidden", "true");
      return image;
    }
    const node = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    node.setAttribute("class", "nuvio-icon");
    node.setAttribute("viewBox", "0 0 24 24");
    node.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("fill", "currentColor");
    path.setAttribute("d", kind === "check" ?
      "M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" :
      "M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z");
    node.append(path);
    if (kind === "spinner") node.style.animation = "nuvio-letterboxd-spin .8s linear infinite";
    return node;
  }

  function toast(message, failed = false) {
    document.getElementById("nuvio-letterboxd-toast")?.remove();
    const element = document.createElement("div");
    element.id = "nuvio-letterboxd-toast";
    element.textContent = message;
    if (failed) element.style.borderColor = "#ff8d85";
    const rect = document.getElementById(ROW_ID)?.getBoundingClientRect();
    element.style.top = `${rect ? rect.bottom + 6 : 100}px`;
    element.style.left = `${rect ? Math.max(8, rect.left) : 100}px`;
    document.body.append(element);
    setTimeout(() => element.remove(), 4000);
  }

  function inject() {
    if (document.getElementById(ROW_ID)) return;
    const info = metadata();
    const watch = document.querySelector(".watch-panel #watch");
    if (!info || !watch) return;
    let services = watch.querySelector("section.services");
    if (!services) {
      services = document.createElement("section");
      services.className = "services";
      watch.prepend(services);
    }

    const row = document.createElement("div");
    row.id = ROW_ID;
    row.className = "service";
    const main = document.createElement("button");
    main.type = "button";
    main.className = "nuvio-main";
    const lines = document.createElement("span");
    lines.className = "nuvio-lines";
    const label = document.createElement("span");
    label.className = "nuvio-label";
    const subtitle = document.createElement("span");
    subtitle.className = "nuvio-subtitle";
    lines.append(label, subtitle);
    main.append(lines);
    const caret = document.createElement("button");
    caret.type = "button";
    caret.className = "nuvio-profile";
    caret.textContent = "⌄";
    caret.setAttribute("aria-label", "Select Nuvio profile");
    row.append(main, caret);
    services.prepend(row);

    const menu = document.createElement("div");
    menu.id = MENU_ID;
    document.body.append(menu);

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
      const currentIcon = loading ? icon("spinner") : inLibrary ? icon("check") : icon("nuvio");
      main.querySelector(".nuvio-icon")?.remove();
      main.insertBefore(currentIcon, lines);
      label.textContent = loading ? (operation === "check" ? "Checking Nuvio..." :
        operation === "remove" ? "Removing..." : "Adding...") :
        lastError === RELOAD_MESSAGE ? "Reload page" :
        lastError ? "Error — retry" : !connected ? "Connect Nuvio" :
        inLibrary ? "In Nuvio" : "Add to Nuvio";
      subtitle.textContent = connected ? profileName() : "Visit nuvio.tv to sync";
      main.disabled = loading;
      caret.disabled = loading || !connected;
      caret.hidden = !connected;
      main.setAttribute("aria-label", label.textContent + (subtitle.textContent ? ` — ${subtitle.textContent}` : ""));
    }

    async function refresh() {
      const requestNumber = ++sequence;
      loading = true;
      operation = "check";
      lastError = null;
      render();
      try {
        const state = await send({ type: "GET_STATE", imdbId: info.imdbId, contentType: info.contentType });
        if (requestNumber !== sequence || !row.isConnected) return;
        connected = state.connected;
        inLibrary = state.inLibrary;
        profileId = state.profileId;
        profiles = state.profiles || [];
      } catch (error) {
        if (requestNumber !== sequence || !row.isConnected) return;
        lastError = error.message;
        toast(error.message, true);
      } finally {
        if (requestNumber === sequence && row.isConnected) { loading = false; render(); }
      }
    }

    main.addEventListener("click", async event => {
      if (!event.isTrusted || loading) return;
      if (lastError && !connected) { refresh(); return; }
      if (!connected) { window.open("https://nuvio.tv/", "_blank", "noopener"); return; }
      ++sequence;
      const removing = inLibrary;
      loading = true;
      operation = removing ? "remove" : "add";
      lastError = null;
      render();
      try {
        const result = await send({
          type: removing ? "REMOVE" : "ADD", imdbId: info.imdbId,
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
      menu.style.top = `${rect.bottom + 4}px`;
      const menuWidth = Math.min(190, window.innerWidth - 16);
      menu.style.left = `${Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8))}px`;
      menu.classList.toggle("open", opening);
    });

    document.addEventListener("click", event => {
      if (!menu.contains(event.target) && event.target !== caret) menu.classList.remove("open");
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && row.isConnected) refresh();
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
