# PulsePup - Nagios Core Read-Only Dashboard

A simple, read-only companion dashboard for Nagios Core. PulsePup reads your local `status.dat` file and displays host/service status in a modern web UI.

**This app does not modify Nagios.** It does not send commands, change configuration, or write to any Nagios files.

## What it shows

- **Dashboard** - Summary counts for hosts and services, plus current problem totals
- **Hosts** - All monitored hosts with state, output, and last check time
- **Services** - All monitored services with state and plugin output
- **Problems** - Hosts that are down/unreachable and services that are warning/critical/unknown

Features: search, state filters, column sorting, auto-refresh every 60 seconds, and a friendly error message if `status.dat` cannot be read.

## Requirements

- Python 3.8 or newer
- Nagios Core with a readable `status.dat` file
- Linux server (same machine as Nagios Core)

## Quick start (test with sample data)

The project includes `sample-status.dat`, a real Nagios 4.4.14 export you can use for safe testing without touching live Nagios.

```bash
cd /opt/pulsepup          # or wherever you placed the project
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp config.json.example config.json
python app.py
```

Open your browser to `http://127.0.0.1:8080`. You should see 21 hosts, 109 services, and 2 service problems.

## Configuration

Copy the example config and edit it:

```bash
cp config.json.example config.json
```

| Setting | Description | Default |
|---------|-------------|---------|
| `status_dat_path` | Path to live Nagios status.dat | `/usr/local/nagios/var/status.dat` |
| `use_sample_data` | Use sample file instead of live data | `true` |
| `sample_dat_path` | Path to sample file (relative to app dir) | `sample-status.dat` |
| `host` | IP address to bind to | `127.0.0.1` |
| `port` | Port to listen on | `8080` |
| `refresh_seconds` | How often the browser auto-refreshes | `60` |

### Switch to live Nagios data

Edit `config.json`:

```json
{
  "use_sample_data": false,
  "status_dat_path": "/usr/local/nagios/var/status.dat",
  "host": "192.168.1.50",
  "port": 8080
}
```

Replace `192.168.1.50` with your server's internal LAN IP address.

### File permissions

The dashboard user must be able to read `status.dat`. Options:

```bash
# Option 1: Add dashboard user to the nagios group
sudo usermod -aG nagios pulsepup

# Option 2: Make status.dat group-readable (if nagios group owns it)
sudo chmod g+r /usr/local/nagios/var/status.dat
```

Do not modify Nagios source code or configuration files to achieve this.

## LAN access

By default the app binds to `127.0.0.1` (localhost only). For direct access from other machines on your LAN:

1. Set `host` in `config.json` to your server's **internal IP** (e.g. `192.168.1.50`).
2. Do **not** use `0.0.0.0` unless you understand the security implications.
3. Restrict access with your host firewall:

```bash
# Example: allow only your LAN subnet
sudo ufw allow from 192.168.0.0/16 to any port 8080
```

## Running manually

```bash
cd /opt/pulsepup
source venv/bin/activate
python app.py
```

Press Ctrl+C to stop.

## Running 24/7 with systemd

Create a dedicated user:

```bash
sudo useradd --system --home-dir /opt/pulsepup --shell /usr/sbin/nologin pulsepup
sudo chown -R pulsepup:pulsepup /opt/pulsepup
```

Create the service file `/etc/systemd/system/pulsepup.service`:

```ini
[Unit]
Description=PulsePup Nagios Dashboard
After=network.target nagios.service

[Service]
Type=simple
User=pulsepup
Group=pulsepup
WorkingDirectory=/opt/pulsepup
ExecStart=/opt/pulsepup/venv/bin/python app.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable pulsepup
sudo systemctl start pulsepup
sudo systemctl status pulsepup
```

View logs:

```bash
sudo journalctl -u pulsepup -f
```

## Security notes

- **Read-only** - The app only reads `status.dat`. It cannot send Nagios commands or change configuration.
- **No authentication in v1** - If you expose the dashboard on your LAN, anyone on the allowed network can view it. Use firewall rules to limit access to trusted subnets.
- **Bind to internal IP only** - Set `host` to your server's LAN IP, not `0.0.0.0`.
- **Run as unprivileged user** - The systemd example uses a dedicated `pulsepup` user, not root.
- **Future hardening** (not implemented): Put nginx in front with HTTP basic auth, or access only via VPN.

## Project structure

```
pulsepup/
├── app.py                 # Flask app and status.dat parser
├── CHANGELOG.md           # Version history
├── config.json            # Your local config (not in git)
├── config.json.example    # Template config
├── requirements.txt       # Python dependencies
├── sample-status.dat      # Test data (real Nagios 4.4.14 export)
├── templates/
│   └── index.html         # Dashboard page
├── static/
│   ├── styles.css         # Dashboard styling
│   └── app.js             # Frontend logic
└── README.md
```

## Editing with Cursor Remote SSH

1. Install the Remote SSH extension in Cursor.
2. Connect to your Nagios Linux server.
3. Open the project folder (e.g. `/opt/pulsepup`).
4. Edit files directly on the server.
5. Restart the service after changes: `sudo systemctl restart pulsepup`

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Status file not found" | Check `status_dat_path` in config.json |
| "Permission denied" | Add user to nagios group or adjust file permissions |
| Blank page | Check `sudo journalctl -u pulsepup` for errors |
| Cannot reach from LAN | Verify `host` is set to internal IP and firewall allows the port |
