(function () {
  "use strict";

  // ---------- Setup ----------
  var client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  var MIN_LEN = 10;
  var MAX_LEN = 4000;

  var loadingView = document.getElementById("loading-view");
  var surveyView = document.getElementById("survey-view");
  var resultsView = document.getElementById("results-view");
  var fatalErrorView = document.getElementById("fatal-error-view");

  var principleTitleEl = document.getElementById("principle-title");
  var principleSummaryEl = document.getElementById("principle-summary");
  var form = document.getElementById("response-form");
  var textarea = document.getElementById("response-text");
  var charCountEl = document.getElementById("char-count");
  var submitBtn = document.getElementById("submit-btn");
  var submitErrorEl = document.getElementById("submit-error");
  var overallScoreDisplay = document.getElementById("overall-score-display");
  var panelListEl = document.getElementById("panel-list");
  var confettiContainer = document.getElementById("confetti-container");

  var currentPrinciple = null;
  var sessionId = getOrCreateSessionId();

  function showOnly(view) {
    [loadingView, surveyView, resultsView, fatalErrorView].forEach(function (v) {
      if (v) v.classList.toggle("hidden", v !== view);
    });
  }

  function getOrCreateSessionId() {
    var key = "shingo_voice_session_id";
    var existing = sessionStorage.getItem(key);
    if (existing) return existing;
    var id =
      window.crypto && window.crypto.randomUUID
        ? window.crypto.randomUUID()
        : "sid-" + Date.now() + "-" + Math.random().toString(16).slice(2);
    sessionStorage.setItem(key, id);
    return id;
  }

  // ---------- Load a random principle ----------
  async function loadPrinciple() {
    try {
      var res = await client.from("principles").select("*");
      if (res.error) throw res.error;
      var rows = res.data || [];
      if (!rows.length) throw new Error("No principles returned");

      currentPrinciple = rows[Math.floor(Math.random() * rows.length)];
      principleTitleEl.textContent = currentPrinciple.title;
      principleSummaryEl.textContent = currentPrinciple.summary;
      showOnly(surveyView);

      // Fire-and-forget page view log; never blocks UI, never surfaces errors.
      client
        .from("page_views")
        .insert({ session_id: sessionId, principle_id: currentPrinciple.id })
        .then(
          function () {},
          function () {}
        );
    } catch (err) {
      console.error("Failed to load principles:", err);
      showOnly(fatalErrorView);
    }
  }

  // ---------- Character counter / validation ----------
  textarea.addEventListener("input", function () {
    var len = textarea.value.length;
    charCountEl.textContent = len + " / " + MAX_LEN;
    submitBtn.disabled = len < MIN_LEN || len > MAX_LEN;
  });

  // ---------- Playful "assessors panel" heuristic scoring ----------
  var STOPWORDS = new Set([
    "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for",
    "is", "are", "was", "were", "be", "been", "it", "its", "that", "this",
    "with", "as", "at", "by", "from", "we", "our", "you", "your", "i",
  ]);

  function keywordsFrom(text) {
    return (text || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(function (w) {
        return w.length > 2 && !STOPWORDS.has(w);
      });
  }

  function countMatches(answerWords, keywordSet) {
    var count = 0;
    for (var i = 0; i < answerWords.length; i++) {
      if (keywordSet.has(answerWords[i])) count++;
    }
    return count;
  }

  function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
  }

  function randomJitter(spread) {
    return (Math.random() * 2 - 1) * spread;
  }

  function buildPanel(answerText, principle) {
    var trimmed = answerText.trim();
    var answerWords = keywordsFrom(trimmed);
    var principleKeywordSet = new Set(
      keywordsFrom((principle.title || "") + " " + (principle.summary || ""))
    );
    var overlap = countMatches(answerWords, principleKeywordSet);
    var wordCount = answerWords.length;
    var exclamations = (trimmed.match(/!/g) || []).length;
    var questions = (trimmed.match(/\?/g) || []).length;

    var improvementWords = new Set([
      "improve", "improving", "improvement", "better", "continuous",
      "learn", "learning", "grow", "growth", "iterate", "iteration",
      "progress", "kaizen",
    ]);
    var customerWords = new Set([
      "customer", "customers", "value", "client", "clients", "user",
      "users", "quality", "service", "experience",
    ]);

    // Judge Gemba Gary: rewards specificity/detail and keyword grounding.
    var garyBase = 45 + Math.min(wordCount, 60) * 0.55 + overlap * 6;
    var garyScore = clamp(Math.round(garyBase + randomJitter(8)), 0, 100);

    // Professor Kaizen: rewards improvement-oriented language.
    var kaizenHits = countMatches(answerWords, improvementWords);
    var kaizenBase = 50 + kaizenHits * 12 + Math.min(wordCount, 40) * 0.3;
    var kaizenScore = clamp(Math.round(kaizenBase + randomJitter(10)), 0, 100);

    // The Customer: rewards customer/value language, enthusiasm, and clarity
    // (mild penalty for extremely long, rambling answers).
    var customerHits = countMatches(answerWords, customerWords);
    var lengthPenalty = wordCount > 220 ? (wordCount - 220) * 0.1 : 0;
    var customerBase =
      48 + customerHits * 10 + exclamations * 4 + questions * 2 - lengthPenalty;
    var customerScore = clamp(Math.round(customerBase + randomJitter(9)), 0, 100);

    var garyComments = [
      "Solid gemba energy — I can picture you walking the floor.",
      "Concrete and grounded. Bring me more shopfloor stories next time.",
      "A bit abstract for my taste, but the instinct is there.",
      "You clearly know the principle isn't just a poster on the wall.",
    ];
    var kaizenComments = [
      "I sense a growth mindset blooming in this answer.",
      "Continuous improvement vibes, though I want more 'how'.",
      "Solid — now go PDCA your way to an even better answer.",
      "Room to iterate, but every draft is progress.",
    ];
    var customerComments = [
      "Would a customer feel this? Mostly, yes.",
      "Short, sweet, and value-focused. I approve.",
      "A little long-winded, but I appreciate the enthusiasm!",
      "Bring it back to the customer once more and you've nailed it.",
    ];

    function pick(arr, score) {
      var idx = clamp(Math.floor((score / 100) * arr.length), 0, arr.length - 1);
      // Add a touch of randomness so repeat visits don't feel scripted.
      if (Math.random() < 0.3) {
        idx = Math.floor(Math.random() * arr.length);
      }
      return arr[idx];
    }

    var panel = [
      {
        judge: "Judge Gemba Gary",
        score: garyScore,
        comment: pick(garyComments, garyScore),
      },
      {
        judge: "Professor Kaizen",
        score: kaizenScore,
        comment: pick(kaizenComments, kaizenScore),
      },
      {
        judge: "The Customer",
        score: customerScore,
        comment: pick(customerComments, customerScore),
      },
    ];

    var overall = clamp(
      Math.round((garyScore + kaizenScore + customerScore) / 3),
      0,
      100
    );

    return { panel: panel, overall: overall };
  }

  // ---------- Results rendering ----------
  var CONFETTI_COLORS = [
    "#2f6f4f", "#c9971f", "#4caf7d", "#e0b64a", "#1e4d34", "#b3261e",
  ];

  function renderConfetti() {
    confettiContainer.innerHTML = "";
    var pieceCount = 24;
    for (var i = 0; i < pieceCount; i++) {
      var span = document.createElement("span");
      span.style.left = Math.random() * 100 + "%";
      span.style.background =
        CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
      span.style.animationDelay = Math.random() * 1.5 + "s";
      span.style.animationDuration = 2 + Math.random() * 1.5 + "s";
      confettiContainer.appendChild(span);
    }
  }

  function renderResults(overall, panel) {
    overallScoreDisplay.textContent = "Overall score: " + overall + " / 100";
    panelListEl.innerHTML = "";
    panel.forEach(function (entry) {
      var item = document.createElement("div");
      item.className = "panel-item";

      var row = document.createElement("div");
      row.className = "judge-row";

      var name = document.createElement("span");
      name.textContent = entry.judge;

      var score = document.createElement("span");
      score.className = "judge-score";
      score.textContent = entry.score + "/100";

      row.appendChild(name);
      row.appendChild(score);

      var comment = document.createElement("p");
      comment.className = "judge-comment";
      comment.textContent = entry.comment;

      item.appendChild(row);
      item.appendChild(comment);
      panelListEl.appendChild(item);
    });

    renderConfetti();
    showOnly(resultsView);
  }

  // ---------- Submit handling ----------
  form.addEventListener("submit", async function (evt) {
    evt.preventDefault();
    submitErrorEl.classList.add("hidden");

    var text = textarea.value.trim();
    if (text.length < MIN_LEN || text.length > MAX_LEN || !currentPrinciple) {
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Judging in progress…";

    var result = buildPanel(text, currentPrinciple);

    try {
      var res = await client.from("responses").insert({
        session_id: sessionId,
        principle_id: currentPrinciple.id,
        response_text: text,
        score: result.overall,
        panel: result.panel,
      });
      if (res.error) throw res.error;

      renderResults(result.overall, result.panel);
    } catch (err) {
      console.error("Failed to submit response:", err);
      submitErrorEl.textContent =
        "We couldn't submit your answer (a network hiccup, most likely). Your text is still here — please try again.";
      submitErrorEl.classList.remove("hidden");
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit for judging";
    }
  });

  // ---------- Kick off ----------
  loadPrinciple();
})();
