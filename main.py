import asyncio
import json
import os
import time
import urllib.error
import urllib.request

import decky


DEFAULT_SETTINGS = {
    "markHostile": True,
    "markUkrainian": True,
    "hostileColor": "#7a2a2a",
    "ukrainianColor": "#27ae60",
    "overlayOpacity": 0.35,
    "showBadges": True,
}

CACHE_TTL_SECONDS = 60 * 60 * 24 * 14


class Plugin:
    async def _main(self):
        await self._ensure_loaded()

    async def _ensure_loaded(self):
        if getattr(self, "_loaded", False):
            return
        self._plugin_dir = os.path.dirname(os.path.realpath(__file__))
        self._data_path = os.path.join(self._plugin_dir, "data", "developers.json")
        self._settings_path = os.path.join(decky.DECKY_SETTINGS_DIR, "settings.json")
        self._cache_path = os.path.join(decky.DECKY_RUNTIME_DIR, "appdetails-cache.json")
        self._lock = asyncio.Lock()
        self._database = self._load_database()
        self._settings = self._load_json(self._settings_path, DEFAULT_SETTINGS)
        self._cache = self._load_json(self._cache_path, {})
        self._hostile_set = set(self._database.get("hostile", []))
        self._ukrainian_set = set(self._database.get("ukrainian", []))
        self._loaded = True
        decky.logger.info(f"POHRAI/NE HRAI loaded {len(self._hostile_set)} hostile and {len(self._ukrainian_set)} Ukrainian entries")

    async def _unload(self):
        await self._ensure_loaded()
        await self._save_cache()
        self._save_json(self._settings_path, self._settings)

    async def get_database_stats(self):
        await self._ensure_loaded()
        return {
            "version": self._database.get("version", "unknown"),
            "hostileCount": len(self._hostile_set),
            "ukrainianCount": len(self._ukrainian_set),
            "cacheCount": len(self._cache),
        }

    async def get_settings(self):
        await self._ensure_loaded()
        return {**DEFAULT_SETTINGS, **self._settings}

    async def save_settings(self, settings):
        await self._ensure_loaded()
        sanitized = {**DEFAULT_SETTINGS, **settings}
        sanitized["overlayOpacity"] = min(1, max(0.05, float(sanitized["overlayOpacity"])))
        self._settings = sanitized
        self._save_json(self._settings_path, self._settings)
        return self._settings

    async def get_app_status(self, appid):
        await self._ensure_loaded()
        appid = str(appid).strip()
        if not appid:
            return self._empty_status(appid)

        async with self._lock:
            cached = self._cache.get(appid)
            if cached and time.time() - cached.get("fetchedAt", 0) < CACHE_TTL_SECONDS:
                return self._mark_status(appid, cached.get("developers", []), cached.get("publishers", []))

        details = await asyncio.to_thread(self._fetch_appdetails, appid)
        if not details:
            return self._empty_status(appid)

        async with self._lock:
            self._cache[appid] = {
                "developers": details.get("developers", []),
                "publishers": details.get("publishers", []),
                "fetchedAt": int(time.time()),
            }
            await self._save_cache()

        return self._mark_status(appid, details.get("developers", []), details.get("publishers", []))

    async def search_database(self, query, limit=40):
        await self._ensure_loaded()
        needle = query.strip().lower()
        if not needle:
            return {"hostile": [], "ukrainian": []}

        def search(items):
            matches = [name for name in items if needle in name.lower()]
            return matches[: max(1, min(int(limit), 100))]

        return {
            "hostile": search(self._database.get("hostile", [])),
            "ukrainian": search(self._database.get("ukrainian", [])),
        }

    def _mark_status(self, appid, developers, publishers):
        names = [*developers, *publishers]
        hostile = [name for name in names if name in self._hostile_set]
        ukrainian = [name for name in names if name in self._ukrainian_set]
        mark_type = None
        if self._settings.get("markHostile", True) and hostile:
            mark_type = "hostile"
        elif self._settings.get("markUkrainian", True) and ukrainian:
            mark_type = "ukrainian"

        return {
            "appid": appid,
            "type": mark_type,
            "developers": developers,
            "publishers": publishers,
            "matches": {
                "hostile": hostile,
                "ukrainian": ukrainian,
            },
        }

    def _empty_status(self, appid):
        return {
            "appid": appid,
            "type": None,
            "developers": [],
            "publishers": [],
            "matches": {"hostile": [], "ukrainian": []},
        }

    def _fetch_appdetails(self, appid):
        url = f"https://store.steampowered.com/api/appdetails?appids={appid}"
        req = urllib.request.Request(url, headers={"User-Agent": "decky-pohrai-ne-hrai/0.1"})
        try:
            with urllib.request.urlopen(req, timeout=12) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            decky.logger.warning("Failed to fetch appdetails for %s: %s", appid, exc)
            return None

        entry = payload.get(appid)
        if not entry or not entry.get("success") or not entry.get("data"):
            return None

        data = entry["data"]
        return {
            "developers": data.get("developers") or [],
            "publishers": data.get("publishers") or [],
        }

    def _load_database(self):
        return self._load_json(self._data_path, {"hostile": [], "ukrainian": []})

    def _load_json(self, path, fallback):
        try:
            with open(path, "r", encoding="utf-8") as handle:
                return json.load(handle)
        except (FileNotFoundError, json.JSONDecodeError):
            return fallback.copy() if isinstance(fallback, dict) else fallback

    def _save_json(self, path, data):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp_path = f"{path}.tmp"
        with open(tmp_path, "w", encoding="utf-8") as handle:
            json.dump(data, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        os.replace(tmp_path, path)

    async def _save_cache(self) -> None:
        await asyncio.to_thread(self._save_json, self._cache_path, self._cache)
