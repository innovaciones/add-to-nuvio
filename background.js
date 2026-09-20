"use strict";

const API = "https://api.nuvio.tv";
const CATALOG = "https://catalog.nuvio.tv";
// Public Supabase anon key from https://nuvio.tv/config.js (not a user secret).
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzgxNTIxMzQ2LCJleHAiOjE5MzkyMDEzNDZ9.tmQaj682pwzehpqlgCDMnySOqiUvpgRbrE43T4VJpDI";

const getData = async () => chrome.storage.local.get(["session", "profiles", "profileId", "profileChosen", "clientId"]);
const setData = async value => chrome.storage.local.set(value);

async function request(url, { method = "GET", body, token } = {}) {
  const headers = { apikey: ANON_KEY };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000)
  });
  const raw = await response.text();
  let data;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  if (!response.ok) {
    throw new Error(`Nuvio request failed (HTTP ${response.status}).`);
  }
  return data;
}

async function validSession() {
  const { session } = await getData();
  if (!session?.access_token) return null;
  if (Number(session.expires_at) > Date.now() / 1000 + 300) return session;
  if (!session.refresh_token) return null;
  try {
    const refreshed = await request(`${API}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST", body: { refresh_token: session.refresh_token }
    });
    if (!refreshed?.access_token) return null;
    const next = {
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token || session.refresh_token,
      expires_at: refreshed.expires_at || Math.floor(Date.now() / 1000) + (refreshed.expires_in || 3600)
    };
    await setData({ session: next });
    return next;
  } catch { return null; }
}

async function requireSession() {
  const session = await validSession();
  if (!session) throw new Error("Nuvio session unavailable. Open nuvio.tv and sign in.");
  return session;
}

async function rpc(name, body, token) {
  return request(`${API}/rest/v1/rpc/${name}`, { method: "POST", body, token });
}

async function profiles(token) {
  const data = await rpc("sync_pull_profiles", {}, token);
  const list = Array.isArray(data) ? data.map(p => ({
    id: Number(p.profile_index), name: String(p.name || `Profile ${p.profile_index}`)
  })).filter(p => Number.isInteger(p.id) && p.id > 0) : [];
  await setData({ profiles: list });
  return list;
}

async function status(imdbId, contentType, profileId, token) {
  for (let offset = 0; offset < 100000; offset += 500) {
    const page = await rpc("sync_pull_library", {
      p_profile_id: profileId, p_limit: 500, p_offset: offset
    }, token);
    if (!Array.isArray(page)) throw new Error("Unexpected response from your Nuvio library.");
    if (page.some(item => item.content_id === imdbId && String(item.content_type).toLowerCase() === contentType)) return true;
    if (page.length < 500) return false;
  }
  throw new Error("Your Nuvio library is too large to check this title.");
}

async function clientId() {
  const data = await getData();
  if (data.clientId) return data.clientId;
  const id = `chrome-imdb-${crypto.randomUUID()}`;
  await setData({ clientId: id });
  return id;
}

async function metadata(imdbId, contentType, fallback) {
  try {
    const result = await request(`${CATALOG}/meta/${contentType}/${imdbId}.json`);
    const m = result?.meta;
    if (m) return {
      content_id: imdbId, content_type: contentType, name: m.name || fallback.name || "",
      poster: m.poster || null, poster_shape: "POSTER", background: m.background || null,
      description: m.description || null, release_info: m.releaseInfo || null,
      imdb_rating: m.imdbRating ? Number(m.imdbRating) : null,
      genres: Array.isArray(m.genres) ? m.genres : [], addon_base_url: CATALOG,
      added_at: Date.now()
    };
  } catch { /* IMDb metadata remains usable when the catalog is unavailable. */ }
  return {
    content_id: imdbId, content_type: contentType, name: fallback.name || "",
    poster: fallback.poster || null, poster_shape: "POSTER", background: null,
    description: fallback.description || null, release_info: fallback.year || null,
    imdb_rating: Number(fallback.rating) || null,
    genres: Array.isArray(fallback.genres) ? fallback.genres : [], addon_base_url: null,
    added_at: Date.now()
  };
}

function normalizedTitle(value) {
  return String(value || "").normalize("NFKD").replace(/\p{M}/gu, "")
    .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

async function resolveTitle(name, year, contentType) {
  if (!["movie", "series"].includes(contentType) || typeof name !== "string" ||
      !name.trim() || name.length > 200 ||
      (year !== null && year !== undefined && (!Number.isInteger(year) || year < 1880 || year > 2100))) {
    throw new Error("Invalid title details.");
  }
  const catalog = contentType === "movie" ? "popular-movies" : "popular-series";
  const result = await request(`${CATALOG}/catalog/${contentType}/${catalog}/search=${encodeURIComponent(name.trim())}.json`);
  if (!Array.isArray(result?.metas)) throw new Error("Could not search the Nuvio catalog.");
  const target = normalizedTitle(name);
  if (!target) throw new Error("Could not identify this title in the Nuvio catalog.");
  const matches = result.metas.filter(item => /^tt\d+$/.test(item?.id || "") &&
    normalizedTitle(item.name) === target).map(item => {
    const releaseYear = Number(String(item.releaseInfo || item.year || "").match(/\d{4}/)?.[0]) || null;
    return { id: item.id, year: releaseYear, distance: year && releaseYear ? Math.abs(year - releaseYear) : null };
  }).filter(item => !year || item.distance === null || item.distance <= 1)
    .sort((a, b) => (a.distance ?? 2) - (b.distance ?? 2));
  if (!matches.length) throw new Error("No reliable match found in the Nuvio catalog.");
  if (matches.length > 1 && (matches[0].distance ?? 2) === (matches[1].distance ?? 2)) {
    throw new Error("Multiple matches found. Nothing was added to avoid choosing the wrong title.");
  }
  return { imdbId: matches[0].id, contentType };
}

async function resolveTmdb(tmdbId, contentType) {
  const result = await request(`${CATALOG}/meta/${contentType}/tmdb:${tmdbId}.json`);
  const imdbId = result?.meta?.id;
  if (/^tt\d+$/.test(imdbId || "")) return { imdbId, contentType };
  const name = result?.meta?.name;
  const year = Number(String(result?.meta?.releaseInfo || "").match(/\d{4}/)?.[0]) || null;
  if (name) return resolveTitle(name, year, contentType);
  throw new Error("No IMDb ID found for this TMDB title in the Nuvio catalog.");
}

function validateTitle(message) {
  if (!/^tt\d+$/.test(message.imdbId) || !["movie", "series"].includes(message.contentType)) {
    throw new Error("Invalid IMDb title.");
  }
}

async function handle(message, sender) {
  const url = sender.url ? new URL(sender.url) : null;
  const hostname = url?.hostname || "";
  const fromNuvio = url?.protocol === "https:" && ["nuvio.tv", "www.nuvio.tv"].includes(hostname);
  const fromImdb = url?.protocol === "https:" && (hostname === "imdb.com" || hostname.endsWith(".imdb.com"));
  const fromLetterboxd = url?.protocol === "https:" &&
    ["letterboxd.com", "www.letterboxd.com"].includes(hostname) &&
    /^\/film\/[^/]+\/?$/.test(url.pathname);
  const fromRottenTomatoes = url?.protocol === "https:" &&
    ["rottentomatoes.com", "www.rottentomatoes.com"].includes(hostname) &&
    /^\/(m|tv)\/[^/]+\/?$/.test(url.pathname);
  const tmdbPath = url?.pathname.match(/^\/(movie|tv)\/(\d+)(?:-[^/]+)?\/?$/);
  const fromTmdb = url?.protocol === "https:" &&
    ["themoviedb.org", "www.themoviedb.org"].includes(hostname) && Boolean(tmdbPath);

  if (message.type === "SYNC_SESSION" && fromNuvio) {
    const incoming = message.session;
    if (incoming?.access_token && typeof incoming.access_token === "string") {
      const session = {
        access_token: incoming.access_token,
        refresh_token: typeof incoming.refresh_token === "string" ? incoming.refresh_token : null,
        expires_at: Number(incoming.expires_at) || 0
      };
      const saved = await getData();
      const changed = saved.session?.access_token !== session.access_token;
      await setData({ session, ...(changed ? { profiles: [] } : {}) });
      if (!saved.profileChosen && Number.isInteger(message.profileId) && message.profileId > 0) {
        await setData({ profileId: message.profileId });
      }
      return { connected: true };
    }
    await chrome.storage.local.remove(["session", "profiles"]);
    return { connected: false };
  }

  if (!fromImdb && !fromLetterboxd && !fromRottenTomatoes && !fromTmdb) throw new Error("Unauthorized source.");

  if (message.type === "RESOLVE_TMDB") {
    if (!fromTmdb || String(message.tmdbId) !== tmdbPath[2] ||
        (tmdbPath[1] === "movie" ? "movie" : "series") !== message.contentType) {
      throw new Error("Unauthorized source.");
    }
    return resolveTmdb(tmdbPath[2], message.contentType);
  }

  if (message.type === "RESOLVE_TITLE") {
    if (!fromRottenTomatoes ||
        (url.pathname.startsWith("/m/") ? "movie" : "series") !== message.contentType) {
      throw new Error("Unauthorized source.");
    }
    return resolveTitle(message.name, message.year, message.contentType);
  }

  if (message.type === "GET_STATE") {
    validateTitle(message);
    const session = await validSession();
    if (!session) return { connected: false, profiles: [], profileId: null, inLibrary: false };
    const saved = await getData();
    let list = saved.profiles || [];
    if (!list.length) list = await profiles(session.access_token);
    const profileId = Number(saved.profileId) || list[0]?.id || 1;
    if (!saved.profileId) await setData({ profileId });
    return {
      connected: true, profiles: list, profileId,
      inLibrary: await status(message.imdbId, message.contentType, profileId, session.access_token)
    };
  }

  if (message.type === "SELECT_PROFILE") {
    const session = await requireSession();
    const list = await profiles(session.access_token);
    const id = Number(message.profileId);
    if (!list.some(p => p.id === id)) throw new Error("Invalid profile.");
    await setData({ profileId: id, profileChosen: true });
    return { profileId: id };
  }

  if (message.type === "ADD" || message.type === "REMOVE") {
    validateTitle(message);
    const session = await requireSession();
    const saved = await getData();
    const profileId = Number(saved.profileId) || 1;
    const common = { p_profile_id: profileId, p_origin_client_id: await clientId() };
    if (message.type === "ADD") {
      const item = await metadata(message.imdbId, message.contentType, message.fallback || {});
      await rpc("sync_push_library_items", { ...common, p_items: [item] }, session.access_token);
    } else {
      await rpc("sync_delete_library_items", {
        ...common, p_keys: [{ content_id: message.imdbId, content_type: message.contentType }]
      }, session.access_token);
    }
    return { profileId, inLibrary: message.type === "ADD" };
  }

  throw new Error("Unsupported operation.");
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handle(message, sender).then(result => sendResponse({ ok: true, result }))
    .catch(error => sendResponse({ ok: false, error: error.message || String(error) }));
  return true;
});
