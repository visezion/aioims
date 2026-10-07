"""Run the built AIMS UI and API locally, then open an app window."""
import argparse
import ctypes
import json
import logging
import os
from pathlib import Path
import subprocess
import sys
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit
from urllib.request import urlopen
import webbrowser

ROOT = Path(__file__).resolve().parents[1]
URL = "http://127.0.0.1:4173"
RUNTIME = ROOT / ".local-app"


def healthy(url, service):
    try:
        with urlopen(url, timeout=2) as response:
            return json.load(response).get("service") == service
    except (OSError, ValueError):
        return False


def wait_for(url, service, process=None):
    for _ in range(90):
        if healthy(url, service):
            return
        if process is not None and process.poll() is not None:
            raise RuntimeError("The API stopped during startup. Check .local-app/api.log.")
        time.sleep(1)
    raise RuntimeError(f"Startup timed out: {url}. Check .local-app logs.")


class AppHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT / "dist"), **kwargs)

    def do_GET(self):
        if urlsplit(self.path).path == "/__aims/local-health":
            body = b'{"service":"aims-local-app"}'
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def list_directory(self, path):
        self.send_error(404)
        return None

    def log_message(self, format, *args):
        logging.info(format, *args)


def open_window():
    for base, relative in [
        (os.environ.get("ProgramFiles(x86)", ""), "Microsoft/Edge/Application/msedge.exe"),
        (os.environ.get("ProgramFiles", ""), "Microsoft/Edge/Application/msedge.exe"),
        (os.environ.get("ProgramFiles", ""), "Google/Chrome/Application/chrome.exe"),
        (os.environ.get("LOCALAPPDATA", ""), "Microsoft/Edge/Application/msedge.exe"),
    ]:
        browser = Path(base) / relative
        if browser.is_file():
            subprocess.Popen([str(browser), f"--app={URL}", "--new-window"])
            return
    webbrowser.open(URL)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    RUNTIME.mkdir(exist_ok=True)
    logging.basicConfig(filename=RUNTIME / "launcher.log", level=logging.INFO)
    backend = None
    server = None
    try:
        # Retain a Windows byte lock for the entire server lifetime, including startup.
        import msvcrt
        with (RUNTIME / "launcher.lock").open("a+b") as lock:
            if os.fstat(lock.fileno()).st_size == 0:
                lock.write(b"0")
                lock.flush()
            lock.seek(0)
            try:
                msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
            except OSError:
                wait_for(URL + "/__aims/local-health", "aims-local-app")
                wait_for("http://127.0.0.1:8001/ready", "aims-python-backend")
                if not args.no_browser:
                    open_window()
                return
            if not (ROOT / "dist/index.html").is_file():
                raise RuntimeError("Build the application first with npm.cmd run build.")
            # Reserve the frontend port before starting the API.
            server = ThreadingHTTPServer(("127.0.0.1", 4173), AppHandler)
            if not healthy("http://127.0.0.1:8001/ready", "aims-python-backend"):
                with (RUNTIME / "api.log").open("ab") as log:
                    backend = subprocess.Popen(
                        [str(ROOT / ".venv/Scripts/python.exe"), "-u",
                         str(ROOT / "python_backend/server.py"), "--host", "127.0.0.1", "--port", "8001"],
                        cwd=ROOT, stdout=log, stderr=subprocess.STDOUT,
                        creationflags=subprocess.CREATE_NO_WINDOW,
                    )
                wait_for("http://127.0.0.1:8001/ready", "aims-python-backend", backend)
            threading.Thread(target=server.serve_forever, daemon=True).start()
            if not args.no_browser:
                open_window()
            while True:
                time.sleep(2)
                if backend is not None and backend.poll() is not None:
                    raise RuntimeError("The API stopped. Reopen the shortcut to restart it. See .local-app/api.log.")
    except KeyboardInterrupt:
        pass
    except Exception as exc:
        logging.exception("Local app failed")
        if not args.no_browser:
            ctypes.windll.user32.MessageBoxW(0, str(exc), "AIMS could not start", 0x10)
        return 1
    finally:
        if server is not None:
            server.server_close()
        if backend is not None and backend.poll() is None:
            backend.terminate()
            backend.wait(timeout=15)
    return 0


if __name__ == "__main__":
    sys.exit(main())
