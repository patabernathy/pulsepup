"""
PulsePup - Read-only Nagios Core dashboard.

Reads status.dat locally and serves a simple web UI.
Does not send commands or modify Nagios configuration.
"""

VERSION = "1.1.0"

import json
import os
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, jsonify, render_template

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

APP_DIR = Path(__file__).resolve().parent
CONFIG_PATH = APP_DIR / "config.json"

# Nagios state integers from status.dat
HOST_STATES = {0: "up", 1: "down", 2: "unreachable"}
SERVICE_STATES = {0: "ok", 1: "warning", 2: "critical", 3: "unknown"}

# Block types we care about (Nagios 3+ and legacy 2.x names)
HOST_BLOCK_TYPES = {"hoststatus", "host"}
SERVICE_BLOCK_TYPES = {"servicestatus", "service"}


def load_config():
    """Load config.json from the app directory."""
    if not CONFIG_PATH.exists():
        raise FileNotFoundError(
            f"Missing {CONFIG_PATH.name}. Copy config.json.example to config.json and edit it."
        )
    with open(CONFIG_PATH, encoding="utf-8") as f:
        return json.load(f)


def get_status_file_path(config):
    """Return the path to the status.dat file based on config."""
    if config.get("use_sample_data", False):
        sample_path = config.get("sample_dat_path", "sample-status.dat")
        path = Path(sample_path)
        if not path.is_absolute():
            path = APP_DIR / path
        return path
    return Path(config.get("status_dat_path", "/usr/local/nagios/var/status.dat"))


# ---------------------------------------------------------------------------
# status.dat parser
# ---------------------------------------------------------------------------

def parse_status_dat(file_path):
    """
    Parse Nagios status.dat into host and service records.

    Uses a simple line-by-line block parser. Splits key=value on the first
    '=' only so values containing '=' (e.g. check_command) are preserved.
    """
    hosts = []
    services = []

    block_type = None
    current = {}

    with open(file_path, encoding="utf-8", errors="replace") as f:
        for raw_line in f:
            line = raw_line.strip()

            # Skip comments and blank lines outside blocks
            if not line or line.startswith("#"):
                continue

            # Start of a new block: "hoststatus {" or "servicestatus {"
            if line.endswith("{"):
                block_type = line[:-1].strip()
                current = {}
                continue

            # End of block
            if line == "}":
                if block_type in HOST_BLOCK_TYPES:
                    hosts.append(current)
                elif block_type in SERVICE_BLOCK_TYPES:
                    services.append(current)
                block_type = None
                current = {}
                continue

            # key=value inside a block
            if "=" in line and block_type is not None:
                key, _, value = line.partition("=")
                current[key.strip()] = value

    return hosts, services


def _safe_int(value, default=0):
    """Convert a string to int, returning default on failure."""
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def build_host_record(raw):
    """Turn a raw hoststatus block into a dashboard-friendly dict."""
    state_num = _safe_int(raw.get("current_state"))
    checked = _safe_int(raw.get("has_been_checked"), 1)

    if checked == 0:
        state = "pending"
    else:
        state = HOST_STATES.get(state_num, "unknown")

    return {
        "name": raw.get("host_name", ""),
        "state": state,
        "state_num": state_num,
        "output": raw.get("plugin_output", ""),
        "last_check": _safe_int(raw.get("last_check")),
        "state_type": "hard" if _safe_int(raw.get("state_type")) == 1 else "soft",
    }


def build_service_record(raw):
    """Turn a raw servicestatus block into a dashboard-friendly dict."""
    state_num = _safe_int(raw.get("current_state"))
    checked = _safe_int(raw.get("has_been_checked"), 1)

    if checked == 0:
        state = "pending"
    else:
        state = SERVICE_STATES.get(state_num, "unknown")

    return {
        "host": raw.get("host_name", ""),
        "description": raw.get("service_description", ""),
        "state": state,
        "state_num": state_num,
        "output": raw.get("plugin_output", ""),
        "last_check": _safe_int(raw.get("last_check")),
        "state_type": "hard" if _safe_int(raw.get("state_type")) == 1 else "soft",
    }


def is_host_problem(host):
    """Simple bad-state rule: down or unreachable."""
    return host["state"] in ("down", "unreachable")


def is_service_problem(service):
    """Simple bad-state rule: warning, critical, or unknown."""
    return service["state"] in ("warning", "critical", "unknown")


def build_summary(hosts, services):
    """Count hosts and services by state."""
    host_counts = {"total": len(hosts), "up": 0, "down": 0, "unreachable": 0, "pending": 0}
    for h in hosts:
        state = h["state"]
        if state in host_counts:
            host_counts[state] += 1

    svc_counts = {
        "total": len(services),
        "ok": 0,
        "warning": 0,
        "critical": 0,
        "unknown": 0,
        "pending": 0,
    }
    for s in services:
        state = s["state"]
        if state in svc_counts:
            svc_counts[state] += 1

    host_problems = sum(1 for h in hosts if is_host_problem(h))
    service_problems = sum(1 for s in services if is_service_problem(s))

    return {
        "hosts": host_counts,
        "services": svc_counts,
        "problems": {"hosts": host_problems, "services": service_problems},
    }


def build_problems_list(hosts, services):
    """Combined list of host and service problems for the Problems tab."""
    problems = []

    for h in hosts:
        if is_host_problem(h):
            problems.append({
                "type": "host",
                "host": h["name"],
                "service": None,
                "state": h["state"],
                "output": h["output"],
                "last_check": h["last_check"],
            })

    for s in services:
        if is_service_problem(s):
            problems.append({
                "type": "service",
                "host": s["host"],
                "service": s["description"],
                "state": s["state"],
                "output": s["output"],
                "last_check": s["last_check"],
            })

    return problems


def read_nagios_status(config):
    """
    Read and parse status.dat, returning a full API payload.

    On error, returns empty data with an error message so the UI can
    show a friendly banner instead of crashing.
    """
    file_path = get_status_file_path(config)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    empty = {
        "last_refresh": now,
        "error": None,
        "refresh_seconds": config.get("refresh_seconds", 60),
        "summary": {
            "hosts": {"total": 0, "up": 0, "down": 0, "unreachable": 0, "pending": 0},
            "services": {"total": 0, "ok": 0, "warning": 0, "critical": 0, "unknown": 0, "pending": 0},
            "problems": {"hosts": 0, "services": 0},
        },
        "hosts": [],
        "services": [],
        "problems": [],
    }

    if not file_path.exists():
        empty["error"] = f"Status file not found: {file_path}"
        return empty

    if not os.access(file_path, os.R_OK):
        empty["error"] = f"Cannot read status file (permission denied): {file_path}"
        return empty

    try:
        raw_hosts, raw_services = parse_status_dat(file_path)
        hosts = [build_host_record(r) for r in raw_hosts]
        services = [build_service_record(r) for r in raw_services]

        # Sort for consistent display
        hosts.sort(key=lambda h: h["name"].lower())
        services.sort(key=lambda s: (s["host"].lower(), s["description"].lower()))

        return {
            "last_refresh": now,
            "error": None,
            "refresh_seconds": config.get("refresh_seconds", 60),
            "summary": build_summary(hosts, services),
            "hosts": hosts,
            "services": services,
            "problems": build_problems_list(hosts, services),
        }
    except OSError as exc:
        empty["error"] = f"Could not read status file: {exc}"
        return empty
    except Exception as exc:
        empty["error"] = f"Failed to parse status file: {exc}"
        return empty


# ---------------------------------------------------------------------------
# Flask application
# ---------------------------------------------------------------------------

app = Flask(__name__)
_config = None


def get_config():
    """Load config once and cache it for the process lifetime."""
    global _config
    if _config is None:
        _config = load_config()
    return _config


@app.route("/")
def index():
    """Serve the dashboard page."""
    config = get_config()
    return render_template(
        "index.html",
        refresh_seconds=config.get("refresh_seconds", 60),
        version=VERSION,
    )


@app.route("/api/status")
def api_status():
    """Return parsed Nagios status as JSON."""
    config = get_config()
    return jsonify(read_nagios_status(config))


if __name__ == "__main__":
    cfg = load_config()
    host = cfg.get("host", "127.0.0.1")
    port = cfg.get("port", 8080)
    print(f"PulsePup starting on http://{host}:{port}")
    print(f"Sample mode: {cfg.get('use_sample_data', False)}")
    app.run(host=host, port=port, debug=False)
