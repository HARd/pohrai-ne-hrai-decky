import asyncio
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

import decky


DEFAULT_SETTINGS = {
    "markHostile": True,
    "markUkrainian": True,
    "hostileColor": "#7a2a2a",
    "ukrainianColor": "#27ae60",
    "overlayOpacity": 0.35,
    "showBadges": True,
    "remoteDatabaseEnabled": True,
    "remoteDatabaseUrl": "https://hrai-decky-default-rtdb.europe-west1.firebasedatabase.app/",
}

CACHE_TTL_SECONDS = 60 * 60 * 24 * 14
REMOTE_DATABASE_TTL_SECONDS = 60 * 60


class Plugin:
    async def _main(self):
        await self._ensure_loaded()

    async def _ensure_loaded(self):
        if getattr(self, "_loaded", False):
            return
        if getattr(self, "_loading", False):
            while getattr(self, "_loading", False):
                await asyncio.sleep(0.1)
            return
        self._loading = True

        self._plugin_dir = os.path.dirname(os.path.realpath(__file__))
        self._data_path = os.path.join(self._plugin_dir, "data", "developers.json")
        self._settings_path = os.path.join(decky.DECKY_SETTINGS_DIR, "settings.json")
        self._cache_path = os.path.join(decky.DECKY_RUNTIME_DIR, "appdetails-cache.json")
        self._lock = asyncio.Lock()
        self._database = self._load_database()
        self._settings = self._load_json(self._settings_path, DEFAULT_SETTINGS)
        self._cache = self._load_json(self._cache_path, {})
        self._database_source = "bundled"
        self._remote_database_url = ""
        self._remote_database_fetched_at = 0
        self._remote_database_error = None
        self._set_database(self._database, "bundled", "")

        self._loaded = True
        self._loading = False
        decky.logger.info(f"POHRAI/NE HRAI loaded {len(self._hostile_set)} hostile and {len(self._ukrainian_set)} Ukrainian entries")

        asyncio.create_task(self._refresh_database())

    async def _unload(self):
        await self._ensure_loaded()
        await self._save_cache()
        self._save_json(self._settings_path, self._settings)

    async def get_database_stats(self):
        await self._ensure_loaded()
        await self._refresh_database()
        return {
            "version": self._database.get("version", "unknown"),
            "hostileCount": len(self._hostile_set),
            "ukrainianCount": len(self._ukrainian_set),
            "cacheCount": len(self._cache),
            "source": self._database_source,
            "remoteUrl": self._remote_database_url or None,
            "lastRemoteError": self._remote_database_error,
        }

    async def get_settings(self):
        await self._ensure_loaded()
        return {**DEFAULT_SETTINGS, **self._settings}

    async def save_settings(self, settings):
        await self._ensure_loaded()
        sanitized = {**DEFAULT_SETTINGS, **settings}
        sanitized["overlayOpacity"] = min(1, max(0.05, float(sanitized["overlayOpacity"])))
        sanitized["remoteDatabaseEnabled"] = bool(sanitized.get("remoteDatabaseEnabled"))
        sanitized["remoteDatabaseUrl"] = str(sanitized.get("remoteDatabaseUrl", "")).strip()
        self._settings = sanitized
        self._save_json(self._settings_path, self._settings)
        await self._refresh_database(force=True)
        return self._settings

    async def refresh_database(self, force=True):
        await self._ensure_loaded()
        await self._refresh_database(force=force)
        return await self.get_database_stats()

    async def get_cef_debugger_url(self):
        import os
        path = os.path.expanduser("~/.local/share/Steam/.cef-enable-remote-debugging")
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    port = f.read().strip()
                    if port.isdigit():
                        return f"http://localhost:{port}/json"
            except Exception:
                pass
        return "http://localhost:8080/json"

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

    async def _refresh_database(self, force=False):
        if getattr(self, "_refreshing", False):
            while getattr(self, "_refreshing", False):
                await asyncio.sleep(0.1)
            if not force:
                return
        self._refreshing = True
        try:
            remote_enabled = self._settings.get("remoteDatabaseEnabled", False)
            remote_url = str(self._settings.get("remoteDatabaseUrl", "")).strip()
            if not remote_enabled or not remote_url:
                self._set_database(self._load_database(), "bundled", "")
                self._remote_database_error = None
                return

            url = self._firebase_json_url(remote_url)
            fresh = (
                not force
                and self._database_source == "remote"
                and self._remote_database_url == url
                and time.time() - self._remote_database_fetched_at < REMOTE_DATABASE_TTL_SECONDS
            )
            if fresh:
                return

            try:
                remote_database = await asyncio.to_thread(self._fetch_remote_database, url)
                self._set_database(remote_database, "remote", url)
                self._remote_database_fetched_at = time.time()
                self._remote_database_error = None
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ValueError) as exc:
                decky.logger.warning("Failed to fetch remote database: %s", exc)
                self._remote_database_error = str(exc)
                if self._database_source != "remote":
                    self._set_database(self._load_database(), "bundled", "")
        finally:
            self._refreshing = False

    def _set_database(self, database, source, remote_url):
        self._database = database
        self._database_source = source
        self._remote_database_url = remote_url
        self._hostile_set = set(self._database.get("hostile", []))
        self._ukrainian_set = set(self._database.get("ukrainian", []))

    def _fetch_remote_database(self, url):
        req = urllib.request.Request(url, headers={"User-Agent": "decky-pohrai-ne-hrai/0.2"})
        with urllib.request.urlopen(req, timeout=12) as response:
            payload = json.loads(response.read().decode("utf-8"))

        if not isinstance(payload, dict) or not isinstance(payload.get("hostile"), list) or not isinstance(payload.get("ukrainian"), list):
            raise ValueError("Remote database must contain hostile[] and ukrainian[] arrays")

        return {
            "version": str(payload.get("version", "remote")),
            "source": payload.get("source", "Firebase Realtime Database"),
            "hostile": [name for name in payload.get("hostile", []) if isinstance(name, str)],
            "ukrainian": [name for name in payload.get("ukrainian", []) if isinstance(name, str)],
        }

    def _firebase_json_url(self, url):
        clean_url = url.split("#", 1)[0].strip()
        if clean_url.endswith(".json") or ".json?" in clean_url:
            return clean_url
        parsed = urllib.parse.urlparse(clean_url)
        path = parsed.path.rstrip("/")
        json_path = f"{path}.json" if path else "/.json"
        return urllib.parse.urlunparse((
            parsed.scheme,
            parsed.netloc,
            json_path,
            "",
            parsed.query,
            "",
        ))

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
