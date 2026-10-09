/**
 * PulsePup dashboard frontend (v1.1).
 * Fetches /api/status, renders tabs, host detail views, search/filter, auto-refresh.
 */

(function () {
    "use strict";

    let statusData = null;
    let refreshTimer = null;
    let currentHostName = null;

    const sortState = {
        hosts: { column: "name", asc: true },
        services: { column: "host", asc: true },
    };

    const NAV_TABS = ["dashboard", "hosts", "services", "problems"];

    async function fetchStatus() {
        try {
            const response = await fetch("/api/status");
            const data = await response.json();
            statusData = data;
            renderAll(data);
        } catch (err) {
            showError("Could not reach the dashboard server. Is the app running?");
            console.error("Fetch error:", err);
        }
    }

    function showError(message) {
        const banner = document.getElementById("error-banner");
        banner.textContent = message;
        banner.classList.remove("hidden");
    }

    function hideError() {
        const banner = document.getElementById("error-banner");
        banner.classList.add("hidden");
    }

    function formatTimestamp(isoString) {
        if (!isoString) return "Never";
        return new Date(isoString).toLocaleString();
    }

    function formatEpoch(epoch) {
        if (!epoch || epoch === 0) return "-";
        return new Date(epoch * 1000).toLocaleString();
    }

    function switchToTab(tabName) {
        currentHostName = null;

        document.querySelectorAll(".tab").forEach(function (t) {
            const isActive = t.getAttribute("data-tab") === tabName;
            t.classList.toggle("active", isActive);
            t.setAttribute("aria-selected", isActive ? "true" : "false");
        });

        document.querySelectorAll(".tab-panel").forEach(function (panel) {
            panel.classList.remove("active");
        });
        document.getElementById("tab-" + tabName).classList.add("active");

        if (location.hash !== "#/" + tabName) {
            history.replaceState(null, "", "#/" + tabName);
        }
    }

    function switchToHostDetail(hostName) {
        currentHostName = hostName;

        document.querySelectorAll(".tab").forEach(function (t) {
            t.classList.remove("active");
            t.setAttribute("aria-selected", "false");
        });

        document.querySelectorAll(".tab-panel").forEach(function (panel) {
            panel.classList.remove("active");
        });
        document.getElementById("tab-host-detail").classList.add("active");

        const hash = "#/host/" + encodeURIComponent(hostName);
        if (location.hash !== hash) {
            history.replaceState(null, "", hash);
        }

        if (statusData) {
            renderHostDetail(statusData, hostName);
        }
    }

    function handleHashChange() {
        const hash = location.hash || "#/dashboard";

        if (hash.startsWith("#/host/")) {
            const hostName = decodeURIComponent(hash.slice("#/host/".length));
            switchToHostDetail(hostName);
            return;
        }

        const tabName = hash.replace("#/", "") || "dashboard";
        if (NAV_TABS.indexOf(tabName) !== -1) {
            switchToTab(tabName);
        } else {
            switchToTab("dashboard");
        }
    }

    function hostDetailUrl(hostName) {
        return "#/host/" + encodeURIComponent(hostName);
    }

    function renderDashboard(data) {
        const h = data.summary.hosts;
        const s = data.summary.services;
        const p = data.summary.problems;

        document.getElementById("hosts-total").textContent = h.total;
        document.getElementById("hosts-up").textContent = h.up;
        document.getElementById("hosts-down").textContent = h.down;
        document.getElementById("hosts-unreachable").textContent = h.unreachable;
        document.getElementById("hosts-pending").textContent = h.pending;

        document.getElementById("services-total").textContent = s.total;
        document.getElementById("services-ok").textContent = s.ok;
        document.getElementById("services-warning").textContent = s.warning;
        document.getElementById("services-critical").textContent = s.critical;
        document.getElementById("services-unknown").textContent = s.unknown;
        document.getElementById("services-pending").textContent = s.pending;

        document.getElementById("problems-total").textContent = p.hosts + p.services;
        document.getElementById("problems-hosts").textContent = p.hosts;
        document.getElementById("problems-services").textContent = p.services;
    }

    function setupDashboardCards() {
        document.querySelectorAll(".card-clickable[data-nav-tab]").forEach(function (card) {
            card.addEventListener("click", function () {
                switchToTab(card.getAttribute("data-nav-tab"));
            });
            card.addEventListener("keydown", function (e) {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    switchToTab(card.getAttribute("data-nav-tab"));
                }
            });
        });
    }

    function stateBadge(state) {
        return '<span class="badge state-' + state + '">' + escapeHtml(state) + "</span>";
    }

    function hostLink(hostName) {
        return '<a href="' + hostDetailUrl(hostName) + '" class="host-link">' +
            escapeHtml(hostName) + "</a>";
    }

    function matchesSearch(item, query, fields) {
        if (!query) return true;
        const lower = query.toLowerCase();
        return fields.some(function (f) {
            return (item[f] || "").toLowerCase().includes(lower);
        });
    }

    function sortItems(items, column, asc) {
        return items.slice().sort(function (a, b) {
            if (column === "last_check") {
                const va = a[column] || 0;
                const vb = b[column] || 0;
                return asc ? va - vb : vb - va;
            }

            const va = (a[column] || "").toString().toLowerCase();
            const vb = (b[column] || "").toString().toLowerCase();
            if (va < vb) return asc ? -1 : 1;
            if (va > vb) return asc ? 1 : -1;
            return 0;
        });
    }

    function renderHosts(data) {
        const search = document.getElementById("hosts-search").value;
        const filter = document.getElementById("hosts-filter").value;
        const sort = sortState.hosts;

        let hosts = data.hosts.filter(function (h) {
            if (filter !== "all" && h.state !== filter) return false;
            return matchesSearch(h, search, ["name", "output", "state"]);
        });

        hosts = sortItems(hosts, sort.column, sort.asc);

        const tbody = document.getElementById("hosts-tbody");
        if (hosts.length === 0) {
            tbody.innerHTML = '<tr class="empty-row"><td colspan="4">No hosts match your filters.</td></tr>';
        } else {
            tbody.innerHTML = hosts.map(function (h) {
                return "<tr>" +
                    "<td>" + hostLink(h.name) + "</td>" +
                    "<td>" + stateBadge(h.state) + "</td>" +
                    '<td class="output-cell">' + escapeHtml(h.output) + "</td>" +
                    "<td>" + formatEpoch(h.last_check) + "</td>" +
                    "</tr>";
            }).join("");
        }

        document.getElementById("hosts-count").textContent =
            "Showing " + hosts.length + " of " + data.hosts.length + " hosts";
    }

    function renderHostDetail(data, hostName) {
        const host = data.hosts.find(function (h) {
            return h.name === hostName;
        });

        document.getElementById("host-detail-name").textContent = hostName;

        if (!host) {
            document.getElementById("host-detail-state").innerHTML =
                '<span class="badge state-unknown">not found</span>';
            document.getElementById("host-detail-state-type").textContent = "";
            document.getElementById("host-detail-output").textContent =
                "This host was not found in the current status data.";
            document.getElementById("host-detail-last-check").textContent = "";
            document.getElementById("host-detail-svc-counts").innerHTML = "";
            document.getElementById("host-detail-services-tbody").innerHTML =
                '<tr class="empty-row"><td colspan="4">No data available.</td></tr>';
            document.getElementById("host-detail-services-count").textContent = "";
            return;
        }

        document.getElementById("host-detail-state").innerHTML = stateBadge(host.state);
        document.getElementById("host-detail-state-type").textContent = host.state_type + " state";
        document.getElementById("host-detail-output").textContent = host.output || "-";
        document.getElementById("host-detail-last-check").textContent =
            "Last check: " + formatEpoch(host.last_check);

        const services = data.services.filter(function (s) {
            return s.host === hostName;
        });

        const counts = { ok: 0, warning: 0, critical: 0, unknown: 0, pending: 0 };
        services.forEach(function (s) {
            if (counts.hasOwnProperty(s.state)) {
                counts[s.state]++;
            }
        });

        document.getElementById("host-detail-svc-counts").innerHTML =
            '<span class="badge badge-ok">OK <strong>' + counts.ok + "</strong></span>" +
            '<span class="badge badge-warning">Warning <strong>' + counts.warning + "</strong></span>" +
            '<span class="badge badge-critical">Critical <strong>' + counts.critical + "</strong></span>" +
            '<span class="badge badge-unknown">Unknown <strong>' + counts.unknown + "</strong></span>" +
            '<span class="badge badge-pending">Pending <strong>' + counts.pending + "</strong></span>" +
            '<span class="host-meta">Total: ' + services.length + "</span>";

        const tbody = document.getElementById("host-detail-services-tbody");
        if (services.length === 0) {
            tbody.innerHTML =
                '<tr class="empty-row"><td colspan="4">No services monitored on this host.</td></tr>';
        } else {
            const sorted = sortItems(services, "description", true);
            tbody.innerHTML = sorted.map(function (s) {
                return "<tr>" +
                    "<td>" + escapeHtml(s.description) + "</td>" +
                    "<td>" + stateBadge(s.state) + "</td>" +
                    '<td class="output-cell">' + escapeHtml(s.output) + "</td>" +
                    "<td>" + formatEpoch(s.last_check) + "</td>" +
                    "</tr>";
            }).join("");
        }

        document.getElementById("host-detail-services-count").textContent =
            services.length + " service(s) on this host";
    }

    function setupHostDetail() {
        document.getElementById("host-detail-back").addEventListener("click", function () {
            switchToTab("hosts");
        });

        document.getElementById("hosts-tbody").addEventListener("click", function (e) {
            const link = e.target.closest(".host-link");
            if (link) {
                e.preventDefault();
                const hostName = decodeURIComponent(link.getAttribute("href").split("/host/")[1]);
                switchToHostDetail(hostName);
            }
        });
    }

    function renderServices(data) {
        const search = document.getElementById("services-search").value;
        const filter = document.getElementById("services-filter").value;
        const sort = sortState.services;

        let services = data.services.filter(function (s) {
            if (filter !== "all" && s.state !== filter) return false;
            return matchesSearch(s, search, ["host", "description", "output", "state"]);
        });

        services = sortItems(services, sort.column, sort.asc);

        const tbody = document.getElementById("services-tbody");
        if (services.length === 0) {
            tbody.innerHTML = '<tr class="empty-row"><td colspan="5">No services match your filters.</td></tr>';
        } else {
            tbody.innerHTML = services.map(function (s) {
                return "<tr>" +
                    "<td>" + hostLink(s.host) + "</td>" +
                    "<td>" + escapeHtml(s.description) + "</td>" +
                    "<td>" + stateBadge(s.state) + "</td>" +
                    '<td class="output-cell">' + escapeHtml(s.output) + "</td>" +
                    "<td>" + formatEpoch(s.last_check) + "</td>" +
                    "</tr>";
            }).join("");
        }

        document.getElementById("services-count").textContent =
            "Showing " + services.length + " of " + data.services.length + " services";
    }

    function renderProblems(data) {
        const search = document.getElementById("problems-search").value;
        const filter = document.getElementById("problems-filter").value;

        let problems = data.problems.filter(function (p) {
            if (filter !== "all" && p.type !== filter) return false;
            return matchesSearch(p, search, ["host", "service", "output", "state", "type"]);
        });

        const tbody = document.getElementById("problems-tbody");
        if (problems.length === 0) {
            tbody.innerHTML = '<tr class="empty-row"><td colspan="6">No current problems. All clear!</td></tr>';
        } else {
            tbody.innerHTML = problems.map(function (p) {
                return "<tr>" +
                    "<td>" + escapeHtml(p.type) + "</td>" +
                    "<td>" + hostLink(p.host) + "</td>" +
                    "<td>" + escapeHtml(p.service || "-") + "</td>" +
                    "<td>" + stateBadge(p.state) + "</td>" +
                    '<td class="output-cell">' + escapeHtml(p.output) + "</td>" +
                    "<td>" + formatEpoch(p.last_check) + "</td>" +
                    "</tr>";
            }).join("");
        }

        document.getElementById("problems-count").textContent =
            "Showing " + problems.length + " of " + data.problems.length + " problems";
    }

    function renderAll(data) {
        document.getElementById("last-refresh").textContent =
            "Last refresh: " + formatTimestamp(data.last_refresh);

        if (data.error) {
            showError(data.error);
        } else {
            hideError();
        }

        renderDashboard(data);
        renderHosts(data);
        renderServices(data);
        renderProblems(data);

        if (currentHostName) {
            renderHostDetail(data, currentHostName);
        }
    }

    function setupTabs() {
        document.querySelectorAll(".tab").forEach(function (tab) {
            tab.addEventListener("click", function () {
                switchToTab(tab.getAttribute("data-tab"));
            });
        });

        ["services-tbody", "problems-tbody"].forEach(function (id) {
            document.getElementById(id).addEventListener("click", function (e) {
                const link = e.target.closest(".host-link");
                if (link) {
                    e.preventDefault();
                    const hostName = decodeURIComponent(link.getAttribute("href").split("/host/")[1]);
                    switchToHostDetail(hostName);
                }
            });
        });

        window.addEventListener("hashchange", handleHashChange);
    }

    function setupFilters() {
        ["hosts", "services", "problems"].forEach(function (name) {
            const searchEl = document.getElementById(name + "-search");
            const filterEl = document.getElementById(name + "-filter");
            if (searchEl) {
                searchEl.addEventListener("input", function () {
                    if (statusData) renderAll(statusData);
                });
            }
            if (filterEl) {
                filterEl.addEventListener("change", function () {
                    if (statusData) renderAll(statusData);
                });
            }
        });

        document.querySelectorAll("#tab-hosts th[data-sort]").forEach(function (th) {
            th.addEventListener("click", function () {
                const col = th.getAttribute("data-sort");
                if (sortState.hosts.column === col) {
                    sortState.hosts.asc = !sortState.hosts.asc;
                } else {
                    sortState.hosts.column = col;
                    sortState.hosts.asc = true;
                }
                if (statusData) renderHosts(statusData);
            });
        });

        document.querySelectorAll("#tab-services th[data-sort]").forEach(function (th) {
            th.addEventListener("click", function () {
                const col = th.getAttribute("data-sort");
                if (sortState.services.column === col) {
                    sortState.services.asc = !sortState.services.asc;
                } else {
                    sortState.services.column = col;
                    sortState.services.asc = true;
                }
                if (statusData) renderServices(statusData);
            });
        });
    }

    function setupAutoRefresh() {
        const seconds = window.PULSEPUP_REFRESH_SECONDS || 60;
        refreshTimer = setInterval(fetchStatus, seconds * 1000);
        document.getElementById("refresh-btn").addEventListener("click", fetchStatus);
    }

    function escapeHtml(text) {
        if (!text) return "";
        const div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
    }

    document.addEventListener("DOMContentLoaded", function () {
        setupTabs();
        setupDashboardCards();
        setupHostDetail();
        setupFilters();
        setupAutoRefresh();
        handleHashChange();
        fetchStatus();
    });
})();
