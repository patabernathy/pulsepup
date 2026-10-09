# Changelog

All notable changes to PulsePup are documented in this file.

## [1.1.0] - 2026-06-14

### Added
- Dashboard summary tiles are clickable and navigate to the matching tab (Hosts, Services, Problems).
- Host detail view showing host status and a summary of all services on that host.
- Host names on the Hosts tab link to their detail view (e.g. `/host/Server1`).
- Shareable URLs for host detail pages via hash routing (`#/host/Server1`).
- Version number displayed in the dashboard footer.

### Changed
- Hosts tab rows are clickable via host name links.
- Restored v1.0.0 color theme and layout (dashboard cards, header, and footer styling).

## [1.0.0] - 2026-06-06

### Added
- Initial read-only Nagios Core dashboard.
- Parses `status.dat` for host and service status.
- Dashboard tab with summary counts.
- Hosts, Services, and Problems tabs with search and filters.
- Auto-refresh every 60 seconds (configurable).
- Sample data mode for safe local testing.
- Linux deployment instructions, systemd service example, and security notes.
