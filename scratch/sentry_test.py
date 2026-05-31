import urllib.request
import json
import time
import uuid
import ssl

SSL_CONTEXT = ssl.create_default_context()
SSL_CONTEXT.check_hostname = False
SSL_CONTEXT.verify_mode = ssl.CERT_NONE
import time
import uuid

dsn = "https://b8414e0a5fa8cc6fce67a6daafe48f37@o426573.ingest.us.sentry.io/4511482012762112"
# parse DSN
parts = dsn.split("@")
key = parts[0].split("//")[1]
host_and_path = parts[1].split("/")
host = host_and_path[0]
project_id = host_and_path[1]

url = f"https://{host}/api/{project_id}/store/"

payload = {
    "event_id": uuid.uuid4().hex,
    "timestamp": int(time.time()),
    "level": "error",
    "logger": "varta-decky-test",
    "platform": "python",
    "message": "Test error from VARTA Sentry Integration Script",
    "tags": {
        "source": "test_script"
    }
}

headers = {
    "Content-Type": "application/json",
    "X-Sentry-Auth": f"Sentry sentry_version=7, sentry_key={key}, sentry_client=varta-decky/1.0"
}

req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")
try:
    with urllib.request.urlopen(req, context=SSL_CONTEXT) as response:
        print("Success:", response.read())
except Exception as e:
    print("Error:", e)
