# Firebase Realtime Database

Upload `realtime-database.json` into Firebase Realtime Database as JSON.

Supported plugin URL formats:

- Database root: `https://PROJECT-default-rtdb.REGION.firebasedatabase.app`
- Path without suffix: `https://PROJECT-default-rtdb.REGION.firebasedatabase.app/pohrai-ne-hrai`
- Full REST URL: `https://PROJECT-default-rtdb.REGION.firebasedatabase.app/pohrai-ne-hrai.json`

If the URL does not end in `.json`, the plugin adds it automatically.

Current default URL:

`https://hrai-decky-default-rtdb.europe-west1.firebasedatabase.app/`

For public read-only access, Firebase rules can allow `.read` and deny `.write`.
Keep write access restricted to the account or tooling that updates the database.

Minimal public read rules:

```json
{
  "rules": {
    ".read": true,
    ".write": false
  }
}
```
