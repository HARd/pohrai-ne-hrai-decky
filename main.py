import asyncio
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
import decky
try:
    import ssl
    SSL_CONTEXT = ssl.create_default_context()
    SSL_CONTEXT.check_hostname = False
    SSL_CONTEXT.verify_mode = ssl.CERT_NONE
except Exception:
    SSL_CONTEXT = None


DEFAULT_SETTINGS = {
    "markHostile": True,
    "markUkrainian": True,
    "hostileColor": "#7a2a2a",
    "ukrainianColor": "#27ae60",
    "overlayOpacity": 0.35,
    "showBadges": True,
    "remoteDatabaseEnabled": True,
    "remoteDatabaseUrl": "https://hrai-decky-default-rtdb.europe-west1.firebasedatabase.app/",
    "libraryBadgePosition": "bottom-right",
    "libraryBadgeStyle": "text",
    "language": "uk",
    "showReportButton": True,
    "lastSeenHostileCount": 0,
    "lastSeenUkrCount": 0,
}

CACHE_TTL_SECONDS = 60 * 60 * 24 * 14
REMOTE_DATABASE_TTL_SECONDS = 60 * 60


class Plugin:
    async def _main(self):
        try:
            await self._ensure_loaded()
        except Exception as e:
            import traceback
            decky.logger.error(f"VARTA _main error:\n{traceback.format_exc()}")

    async def _ensure_loaded(self):
        if getattr(self, "_loaded", False):
            return
        if getattr(self, "_loading", False):
            while getattr(self, "_loading", False):
                await asyncio.sleep(0.1)
            return
        self._loading = True

        try:
            self._plugin_dir = os.path.dirname(os.path.realpath(__file__))
            self._data_path = os.path.join(self._plugin_dir, "data", "developers.json")
            self._settings_path = os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, "settings.json")
            
            if not os.path.exists(self._settings_path):
                self._settings = {}
                self._is_fresh = True
            else:
                self._settings = self._load_json(self._settings_path, DEFAULT_SETTINGS)
                self._is_fresh = False
            
            self._cache_path = os.path.join(decky.DECKY_PLUGIN_RUNTIME_DIR, "appdetails-cache.json")
            self._db_cache_path = os.path.join(decky.DECKY_PLUGIN_RUNTIME_DIR, "database-cache.json")
            self._etags_path = os.path.join(decky.DECKY_PLUGIN_RUNTIME_DIR, "etags.json")
            self._lock = asyncio.Lock()
            self._database = self._load_database()
            self._cache = self._load_json(self._cache_path, {})
            self._etags = self._load_json(self._etags_path, {})
            self._database_source = "bundled"
            self._remote_database_url = ""
            self._remote_database_fetched_at = 0
            self._remote_database_error = None
            self._set_database(self._database, "bundled", "")

            self._loaded = True
            self._cache_dirty = False
            decky.logger.info(f"VARTA loaded {len(self._hostile_set)} hostile and {len(self._ukrainian_set)} Ukrainian entries")

            asyncio.create_task(self._refresh_database())
            asyncio.create_task(self._auto_refresh_loop())
            asyncio.create_task(self._cache_saver_loop())
        except Exception as e:
            decky.logger.error(f"Failed to load Ne Hrai SD backend: {e}")
            raise
        finally:
            self._loading = False

    async def _cache_saver_loop(self):
        while True:
            await asyncio.sleep(30)
            if getattr(self, "_cache_dirty", False):
                try:
                    await self._save_cache(force=True)
                except Exception as e:
                    decky.logger.error(f"Failed to save cache in background loop: {e}")

    async def _unload(self):
        await self._ensure_loaded()
        await self._save_cache(force=True)
        self._save_json(self._settings_path, self._settings)
        self._save_json(self._etags_path, self._etags)

    async def get_database_stats(self):
        try:
            await self._ensure_loaded()
            return {
                "version": self._database.get("version", "unknown"),
                "hostileCount": len(self._hostile_set),
                "ukrainianCount": len(self._ukrainian_set),
                "reportsCount": len(self._database.get("reports", [])),
                "cacheCount": len(self._cache),
                "source": self._database_source,
                "remoteUrl": self._remote_database_url or None,
                "lastRemoteError": self._remote_database_error,
            }
        except Exception as e:
            import traceback
            err_trace = traceback.format_exc()
            decky.logger.error(f"VARTA get_database_stats error:\n{err_trace}")
            return {"error": err_trace}

    async def _auto_refresh_loop(self):
        while True:
            await asyncio.sleep(3600)  # 1 hour
            decky.logger.info("Auto-refreshing VARTA database...")
            try:
                await self._refresh_database()
            except Exception as e:
                decky.logger.error(f"Auto-refresh failed: {e}")

    async def get_settings(self):
        res = {**DEFAULT_SETTINGS, **self._settings}
        res["_is_fresh"] = getattr(self, "_is_fresh", False)
        return res

    async def save_settings(self, *args, **kwargs):
        decky.logger.info(f"save_settings called with args={args} kwargs={kwargs}")
        await self._ensure_loaded()
        
        settings = {}
        if args and isinstance(args[0], dict):
            settings = args[0]
        elif kwargs:
            settings = kwargs.get("settings", kwargs)
            
        if "settings" in settings and isinstance(settings["settings"], dict):
            settings = settings["settings"]
            
        sanitized = {**DEFAULT_SETTINGS, **settings}
        try:
            sanitized["overlayOpacity"] = min(1.0, max(0.05, float(sanitized.get("overlayOpacity", 0.35))))
        except Exception:
            sanitized["overlayOpacity"] = 0.35
            
        sanitized["remoteDatabaseEnabled"] = bool(sanitized.get("remoteDatabaseEnabled", True))
        sanitized["remoteDatabaseUrl"] = str(sanitized.get("remoteDatabaseUrl", "")).strip()
        
        needs_refresh = False
        if self._settings.get("remoteDatabaseEnabled") != sanitized["remoteDatabaseEnabled"]:
            needs_refresh = True
        if self._settings.get("remoteDatabaseUrl") != sanitized["remoteDatabaseUrl"]:
            needs_refresh = True

        self._settings = sanitized
        self._save_json(self._settings_path, self._settings)
        
        if needs_refresh:
            await self._refresh_database(force=True)
            
        return self._settings

    async def set_setting(self, key, value):
        decky.logger.info(f"set_setting: {key} = {value}")
        await self._ensure_loaded()
        self._settings[key] = value
        
        try:
            self._settings["overlayOpacity"] = min(1.0, max(0.05, float(self._settings.get("overlayOpacity", 0.35))))
        except Exception:
            self._settings["overlayOpacity"] = 0.35
            
        self._settings["remoteDatabaseEnabled"] = bool(self._settings.get("remoteDatabaseEnabled", True))
        self._settings["remoteDatabaseUrl"] = str(self._settings.get("remoteDatabaseUrl", "")).strip()

        self._save_json(self._settings_path, self._settings)
        
        if key in ["remoteDatabaseEnabled", "remoteDatabaseUrl"]:
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

        if not hasattr(self, "_inflight"):
            self._inflight = {}

        async with self._lock:
            cached = self._cache.get(appid)
            if cached and time.time() - cached.get("fetchedAt", 0) < CACHE_TTL_SECONDS:
                return self._mark_status(appid, cached.get("name", "Unknown Game"), cached.get("developers", []), cached.get("publishers", []))

            if appid in self._inflight:
                event = self._inflight[appid]
                do_fetch = False
            else:
                event = asyncio.Event()
                self._inflight[appid] = event
                do_fetch = True

        if do_fetch:
            details = await asyncio.get_event_loop().run_in_executor(None, self._fetch_appdetails, appid)
            async with self._lock:
                if details:
                    self._cache[appid] = {
                        "name": details.get("name", "Unknown Game"),
                        "developers": details.get("developers", []),
                        "publishers": details.get("publishers", []),
                        "fetchedAt": int(time.time()),
                    }
                    await self._save_cache()
                event.set()
                del self._inflight[appid]
        else:
            await event.wait()
            async with self._lock:
                cached = self._cache.get(appid)
            if cached:
                return self._mark_status(appid, cached.get("name", "Unknown Game"), cached.get("developers", []), cached.get("publishers", []))
            return self._empty_status(appid)

        if not details:
            return self._empty_status(appid)

        return self._mark_status(appid, details.get("name", "Unknown Game"), details.get("developers", []), details.get("publishers", []))

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

    def _mark_status(self, appid, name, developers, publishers):
        names = [*developers, *publishers]
        hostile = [name for name in names if name in self._hostile_set]
        ukrainian = [name for name in names if name in self._ukrainian_set]
        mark_type = None
        if self._settings.get("markHostile", True) and hostile:
            mark_type = "hostile"
        elif self._settings.get("markUkrainian", True) and ukrainian:
            mark_type = "ukrainian"
        elif str(appid) in self._database.get("reports", []):
            mark_type = "in_review"

        return {
            "appid": appid,
            "name": name,
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
            "name": "Unknown Game",
            "type": None,
            "developers": [],
            "publishers": [],
            "matches": {"hostile": [], "ukrainian": []},
        }

    async def report_game(self, payload):
        await self._ensure_loaded()
        url = payload.get("url")
        data = payload.get("data")
        method = payload.get("method", "POST")
        if not url or not data:
            return False

        def _send():
            try:
                req = urllib.request.Request(url, data=json.dumps(data).encode("utf-8"), headers={"Content-Type": "application/json"}, method=method)
                with urllib.request.urlopen(req, timeout=12, context=SSL_CONTEXT) as response:
                    return response.getcode() == 200
            except Exception as e:
                decky.logger.error(f"Failed to report game: {e}")
                return False

        return await asyncio.get_event_loop().run_in_executor(None, _send)

    def _fetch_appdetails(self, appid):
        url = f"https://store.steampowered.com/api/appdetails?appids={appid}"
        req = urllib.request.Request(url, headers={"User-Agent": "varta-decky/0.2"})
        payload = None
        try:
            with urllib.request.urlopen(req, timeout=8, context=SSL_CONTEXT) as response:
                if response.getcode() == 200:
                    payload = json.loads(response.read().decode("utf-8"))
        except Exception as exc:
            decky.logger.warning("Failed to fetch appdetails from Steam for %s: %s", appid, exc)

        if payload:
            entry = payload.get(appid)
            if entry and entry.get("success") and entry.get("data"):
                data = entry["data"]
                return {
                    "name": data.get("name") or "Unknown Game",
                    "developers": data.get("developers") or [],
                    "publishers": data.get("publishers") or [],
                }

        decky.logger.info(f"Falling back to SteamSpy API for {appid}")
        try:
            spy_url = f"https://steamspy.com/api.php?request=appdetails&appid={appid}"
            spy_req = urllib.request.Request(spy_url, headers={"User-Agent": "varta-decky/0.2"})
            with urllib.request.urlopen(spy_req, timeout=12, context=SSL_CONTEXT) as response:
                if response.getcode() == 200:
                    spy_payload = json.loads(response.read().decode("utf-8"))
                    dev_str = spy_payload.get("developer", "")
                    pub_str = spy_payload.get("publisher", "")
                    devs = [d.strip() for d in dev_str.split(",")] if dev_str else []
                    pubs = [p.strip() for p in pub_str.split(",")] if pub_str else []
                    
                    if devs or pubs:
                        return {
                            "name": spy_payload.get("name", "Unknown Game"),
                            "developers": devs,
                            "publishers": pubs,
                        }
        except Exception as exc:
            decky.logger.warning("Failed to fetch appdetails from SteamSpy for %s: %s", appid, exc)

        return None

    def _load_database(self):
        cached = self._load_json(self._db_cache_path, None)
        if cached is not None and isinstance(cached, dict) and "hostile" in cached:
            return cached
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
                loop = asyncio.get_event_loop()
                base_url = url.split(".json")[0].rstrip("/")
                fetch_args = (base_url, self._etags.copy(), self._database)
                remote_database, new_etags = await loop.run_in_executor(None, self._fetch_remote_database, *fetch_args)
                self._etags = new_etags
                self._set_database(remote_database, "remote", url)
                self._remote_database_fetched_at = time.time()
                self._remote_database_error = None
                await loop.run_in_executor(None, self._save_json, self._db_cache_path, remote_database)
                await loop.run_in_executor(None, self._save_json, self._etags_path, self._etags)
            except Exception as exc:
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

    def _fetch_remote_database(self, base_url, etags, existing_db):
        req = urllib.request.Request(f"{base_url}/.json", headers={"User-Agent": "varta-decky/0.2"})
        if "root" in etags:
            req.add_header("If-None-Match", etags["root"])
            
        try:
            with urllib.request.urlopen(req, timeout=12, context=SSL_CONTEXT) as response:
                etag = response.headers.get("ETag")
                if etag:
                    etags["root"] = etag
                data = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 304:
                return existing_db, etags
            return existing_db, etags
        except Exception:
            return existing_db, etags
            
        if not data or not isinstance(data, dict):
            return existing_db, etags

        hostile = data.get("hostile", [])
        ukrainian = data.get("ukrainian", [])
        version = data.get("version", "remote")
        reports = data.get("reports", {})
        
        report_appids = []
        if isinstance(reports, dict):
            for k, v in reports.items():
                if isinstance(v, dict) and "appid" in v:
                    report_appids.append(str(v["appid"]))
        
        if not isinstance(hostile, list) or not isinstance(ukrainian, list):
            raise ValueError("Remote database must contain hostile[] and ukrainian[] arrays")

        return {
            "version": str(version if isinstance(version, str) else "remote"),
            "source": "Firebase Realtime Database",
            "hostile": [name for name in hostile if isinstance(name, str)],
            "ukrainian": [name for name in ukrainian if isinstance(name, str)],
            "reports": report_appids,
        }, etags

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
        except Exception:
            return fallback.copy() if isinstance(fallback, dict) else fallback

    def _save_json(self, path, data):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp_path = f"{path}.tmp"
        with open(tmp_path, "w", encoding="utf-8") as handle:
            json.dump(data, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        os.replace(tmp_path, path)

    async def _save_cache(self, force=False):
        if not force:
            self._cache_dirty = True
            return
        self._cache_dirty = False
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, self._save_json, self._cache_path, self._cache)


