(function () {
  "use strict";

  // ---------- Config (duplicated intentionally, see README.md) ----------
  var SUPABASE_URL = "https://vnoqyjraukytmizjrzmn.supabase.co";
  var SUPABASE_ANON_KEY = "sb_publishable_NC2HJulrYI1FFL4jjjBEDA_vHIQXujT";
  var client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // ---------- Passphrase gate ----------
  // IMPORTANT: this is a UI deterrent only, NOT real security. Anyone can
  // read this file's source. The actual data protection is Postgres Row
  // Level Security (RLS) on the underlying tables/views (see README.md) —
  // this prompt just keeps casual visitors from stumbling onto the
  // dashboard. Do not rely on it to protect anything sensitive.
  //
  // To change the passphrase: pick a new phrase, compute its SHA-256 hex
  // digest (e.g. in a browser console: run
  //   crypto.subtle.digest('SHA-256', new TextEncoder().encode('your-new-phrase'))
  //   then hex-encode the resulting ArrayBuffer
  // ) and replace PASSPHRASE_SHA256_HEX below with that hex string.
  var PASSPHRASE_SHA256_HEX =
    "796540e7d13557438ecaafbc696092568ae2d27ece295d4c9a7d07a2db1d092e"; // sha256("shingo-review-2026")

  var UNLOCK_KEY = "shingo_dashboard_unlocked";

  var gateView = document.getElementById("gate-view");
  var dashboardView = document.getElementById("dashboard-view");
  var gateForm = document.getElementById("gate-form");
  var gateInput = document.getElementById("gate-input");
  var gateError = document.getElementById("gate-error");

  async function sha256Hex(text) {
    var enc = new TextEncoder().encode(text);
    var digest = await crypto.subtle.digest("SHA-256", enc);
    var bytes = Array.from(new Uint8Array(digest));
    return bytes.map(function (b) {
      return b.toString(16).padStart(2, "0");
    }).join("");
  }

  function unlock() {
    gateView.classList.add("hidden");
    dashboardView.classList.remove("hidden");
    initDashboard();
  }

  if (sessionStorage.getItem(UNLOCK_KEY) === "1") {
    unlock();
  }

  gateForm.addEventListener("submit", async function (evt) {
    evt.preventDefault();
    gateError.classList.add("hidden");
    var hash = await sha256Hex(gateInput.value);
    if (hash === PASSPHRASE_SHA256_HEX) {
      sessionStorage.setItem(UNLOCK_KEY, "1");
      unlock();
    } else {
      gateError.classList.remove("hidden");
      gateInput.value = "";
      gateInput.focus();
    }
  });

  // ---------- Dashboard data + rendering ----------
  var REFRESH_MS = 30000;
  var refreshTimer = null;
  var charts = {};
  var principlesById = {};

  var elVisits = document.getElementById("stat-visits");
  var elSubmissions = document.getElementById("stat-submissions");
  var elConversion = document.getElementById("stat-conversion");
  var elAvgScore = document.getElementById("stat-avg-score");
  var elLastUpdated = document.getElementById("last-updated");
  var elRecentBody = document.getElementById("recent-table-body");

  function fmtTime(d) {
    return d.toLocaleTimeString([], { hour12: false });
  }

  function dayKey(dateLike) {
    var d = new Date(dateLike);
    return (
      d.getFullYear() +
      "-" +
      String(d.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(d.getDate()).padStart(2, "0")
    );
  }

  function last30DayKeys() {
    var keys = [];
    var now = new Date();
    for (var i = 29; i >= 0; i--) {
      var d = new Date(now);
      d.setDate(now.getDate() - i);
      keys.push(dayKey(d));
    }
    return keys;
  }

  async function fetchAll() {
    var [eventsRes, feedRes, principlesRes] = await Promise.all([
      client.from("analytics_events").select("*"),
      client.from("review_feed").select("*"),
      client.from("principles").select("*"),
    ]);

    if (eventsRes.error) throw eventsRes.error;
    if (feedRes.error) throw feedRes.error;
    if (principlesRes.error) throw principlesRes.error;

    return {
      events: eventsRes.data || [],
      feed: feedRes.data || [],
      principles: principlesRes.data || [],
    };
  }

  function computeKpis(events) {
    var visits = 0;
    var submissions = 0;
    var scoreSum = 0;
    var scoreCount = 0;

    events.forEach(function (ev) {
      if (ev.kind === "view") visits++;
      if (ev.kind === "response") {
        submissions++;
        if (typeof ev.score === "number") {
          scoreSum += ev.score;
          scoreCount++;
        }
      }
    });

    var conversion = visits > 0 ? (submissions / visits) * 100 : 0;
    var avgScore = scoreCount > 0 ? scoreSum / scoreCount : 0;

    return {
      visits: visits,
      submissions: submissions,
      conversion: conversion,
      avgScore: avgScore,
    };
  }

  function computeTrend(events) {
    var keys = last30DayKeys();
    var buckets = {};
    keys.forEach(function (k) {
      buckets[k] = { views: 0, submissions: 0 };
    });

    events.forEach(function (ev) {
      var k = dayKey(ev.created_at);
      if (!buckets[k]) return; // outside the 30-day window
      if (ev.kind === "view") buckets[k].views++;
      if (ev.kind === "response") buckets[k].submissions++;
    });

    return {
      labels: keys.map(function (k) {
        return k.slice(5); // MM-DD
      }),
      views: keys.map(function (k) {
        return buckets[k].views;
      }),
      submissions: keys.map(function (k) {
        return buckets[k].submissions;
      }),
    };
  }

  function computePerPrinciple(events, principles) {
    var sorted = principles.slice().sort(function (a, b) {
      return (a.sort_order || 0) - (b.sort_order || 0);
    });
    var counts = {};
    sorted.forEach(function (p) {
      counts[p.id] = 0;
    });
    events.forEach(function (ev) {
      if (ev.kind === "response" && counts[ev.principle_id] !== undefined) {
        counts[ev.principle_id]++;
      }
    });
    return {
      labels: sorted.map(function (p) {
        return p.title;
      }),
      counts: sorted.map(function (p) {
        return counts[p.id];
      }),
    };
  }

  function computeScoreHistogram(events) {
    var buckets = [0, 0, 0, 0, 0]; // 0-20, 21-40, 41-60, 61-80, 81-100
    events.forEach(function (ev) {
      if (ev.kind !== "response" || typeof ev.score !== "number") return;
      var s = ev.score;
      var idx;
      if (s <= 20) idx = 0;
      else if (s <= 40) idx = 1;
      else if (s <= 60) idx = 2;
      else if (s <= 80) idx = 3;
      else idx = 4;
      buckets[idx]++;
    });
    return {
      labels: ["0-20", "21-40", "41-60", "61-80", "81-100"],
      counts: buckets,
    };
  }

  function renderKpis(kpis) {
    elVisits.textContent = kpis.visits.toLocaleString();
    elSubmissions.textContent = kpis.submissions.toLocaleString();
    elConversion.textContent = kpis.conversion.toFixed(1) + "%";
    elAvgScore.textContent = kpis.avgScore.toFixed(1);
  }

  function upsertChart(key, ctxId, config) {
    if (charts[key]) {
      charts[key].data = config.data;
      charts[key].options = config.options;
      charts[key].config.type = config.type;
      charts[key].update();
      return;
    }
    var ctx = document.getElementById(ctxId).getContext("2d");
    charts[key] = new Chart(ctx, config);
  }

  function renderCharts(trend, perPrinciple, histogram) {
    upsertChart("trend", "trend-chart", {
      type: "line",
      data: {
        labels: trend.labels,
        datasets: [
          {
            label: "Visits",
            data: trend.views,
            borderColor: "#2f6f4f",
            backgroundColor: "rgba(47,111,79,0.15)",
            tension: 0.25,
          },
          {
            label: "Submissions",
            data: trend.submissions,
            borderColor: "#c9971f",
            backgroundColor: "rgba(201,151,31,0.15)",
            tension: 0.25,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
      },
    });

    upsertChart("principle", "principle-chart", {
      type: "bar",
      data: {
        labels: perPrinciple.labels,
        datasets: [
          {
            label: "Submissions",
            data: perPrinciple.counts,
            backgroundColor: "#2f6f4f",
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
        plugins: { legend: { display: false } },
      },
    });

    upsertChart("score", "score-chart", {
      type: "bar",
      data: {
        labels: histogram.labels,
        datasets: [
          {
            label: "Responses",
            data: histogram.counts,
            backgroundColor: "#c9971f",
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
        plugins: { legend: { display: false } },
      },
    });
  }

  function renderRecentTable(feed, principles) {
    elRecentBody.innerHTML = "";
    var sorted = feed.slice().sort(function (a, b) {
      return new Date(b.created_at) - new Date(a.created_at);
    });

    sorted.forEach(function (row) {
      var tr = document.createElement("tr");

      var tdDate = document.createElement("td");
      tdDate.textContent = new Date(row.created_at).toLocaleString();

      var tdPrinciple = document.createElement("td");
      var p = principles[row.principle_id];
      tdPrinciple.textContent = p ? p.title : "Unknown (#" + row.principle_id + ")";

      var tdScore = document.createElement("td");
      tdScore.textContent = row.score != null ? row.score : "–";

      var tdExcerpt = document.createElement("td");
      tdExcerpt.className = "excerpt-cell";
      tdExcerpt.textContent = row.response_excerpt || "";

      tr.appendChild(tdDate);
      tr.appendChild(tdPrinciple);
      tr.appendChild(tdScore);
      tr.appendChild(tdExcerpt);
      elRecentBody.appendChild(tr);
    });
  }

  async function refresh() {
    try {
      var data = await fetchAll();

      principlesById = {};
      data.principles.forEach(function (p) {
        principlesById[p.id] = p;
      });

      renderKpis(computeKpis(data.events));
      renderCharts(
        computeTrend(data.events),
        computePerPrinciple(data.events, data.principles),
        computeScoreHistogram(data.events)
      );
      renderRecentTable(data.feed, principlesById);

      elLastUpdated.textContent = "Last updated " + fmtTime(new Date());
    } catch (err) {
      console.error("Dashboard refresh failed:", err);
      elLastUpdated.textContent = "Last updated: refresh failed, retrying…";
    }
  }

  function initDashboard() {
    refresh();
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(function () {
      if (document.visibilityState === "visible") {
        refresh();
      }
    }, REFRESH_MS);
  }
})();
