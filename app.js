(() => {
  "use strict";

  // ---------------------------------------------------------------------
  // Static word lists (bundled in source, not fetched/trained — see
  // GUIDELINES.md #3). Small and deliberately not exhaustive.
  // ---------------------------------------------------------------------

  const STOPWORDS = new Set([
    "a","an","the","and","or","but","if","then","else","of","to","in","on",
    "at","by","for","with","about","against","between","into","through",
    "during","before","after","above","below","from","up","down","out",
    "off","over","under","again","further","once","here","there","when",
    "where","why","how","all","any","both","each","few","more","most",
    "other","some","such","no","nor","not","only","own","same","so","than",
    "too","very","s","t","can","will","just","don","should","now","is",
    "are","was","were","be","been","being","have","has","had","having",
    "do","does","did","doing","would","could","might","must","shall",
    "this","that","these","those","i","you","he","she","it","we","they",
    "them","his","her","its","our","your","their","as","also","etc",
    "including","include","includes","per","via","within","across"
  ]);

  const JD_FILLER = new Set([
    "experience","ability","skills","skill","strong","excellent","good",
    "years","year","work","working","team","role","job","position",
    "candidate","candidates","company","opportunity","responsibilities",
    "responsible","required","requirements","preferred","qualifications",
    "qualified","knowledge","understanding","proven","demonstrated",
    "environment","looking","seeking","join","help","new","plus","must",
    "ideal","successful","related","level","field","area","various",
    "duties","tasks","perform","performing","ensure","ensuring","provide",
    "providing","apply","application","applicants","employer","equal",
    "opportunities","benefits","salary","time","full","part","etc"
  ]);

  // Common hard/soft skill terms — used only to weight genuine candidates
  // higher, not as a source of truth. Deliberately short list.
  const SKILL_HINTS = new Set([
    "javascript","python","java","sql","html","css","react","node","aws",
    "azure","gcp","docker","kubernetes","git","linux","excel","powerpoint",
    "salesforce","sap","tableau","powerbi","figma","photoshop","seo",
    "leadership","communication","management","analysis","analytics",
    "budgeting","forecasting","negotiation","presentation","research",
    "planning","scheduling","recruiting","onboarding","training",
    "compliance","auditing","reporting","marketing","sales","design",
    "engineering","testing","debugging","architecture","strategy",
    "operations","logistics","procurement","accounting","finance",
    "collaboration","mentoring","stakeholder","agile","scrum","c",
    "typescript","ruby","php","swift","kotlin","golang","rust","mysql",
    "postgresql","mongodb","redis","api","apis","ux","ui","crm","erp"
  ]);

  // Matches the maxlength attribute on the JD/resume textareas in
  // index.html. Also enforced here in JS for text set programmatically
  // (PDF extraction), since maxlength only guards typed/pasted input.
  const MAX_TEXT_LENGTH = 20000;

  const FREE_SCANS_PER_DAY = 5;
  const STORAGE_KEY = "gudanah-ats-scan-log";
  const WELCOME_KEY = "gudanah-ats-welcome-seen";

  // Set this to your deployed Cloudflare Worker URL to enable the AI
  // Verdict button (see worker/README.md). Left empty, the feature stays
  // hidden and the keyword checker works exactly as before — see
  // GUIDELINES.md #4.
  const AI_VERDICT_ENDPOINT = "";

  // ---------------------------------------------------------------------
  // Text processing
  // ---------------------------------------------------------------------

  function normalize(text) {
    return text.toLowerCase();
  }

  // Tokenize keeping tech-flavored tokens like c++, node.js, c# intact.
  function tokenize(text) {
    const matches = normalize(text).match(/[a-z0-9][a-z0-9+#.]*[a-z0-9]|[a-z0-9]/g);
    return matches ? matches.filter(w => w.length > 1 || /[a-z]/.test(w)) : [];
  }

  function isContentWord(word) {
    return word.length > 1 && !STOPWORDS.has(word) && !JD_FILLER.has(word) && !/^\d+$/.test(word);
  }

  // Light stemmer so manage/managing/managed/manages match.
  function stem(word) {
    if (word.length <= 4) return word;
    return word
      .replace(/(ing|ies|ied)$/, m => (m === "ing" ? "" : "y"))
      .replace(/(es|ed)$/, "")
      .replace(/s$/, "");
  }

  function extractKeywords(jdText) {
    const rawTokens = tokenize(jdText);
    const freq = new Map(); // key: display term, value: {count, weight, isPhrase}

    // Unigrams
    rawTokens.forEach(tok => {
      if (!isContentWord(tok)) return;
      const key = stem(tok);
      const entry = freq.get(key) || { display: tok, count: 0, isPhrase: false };
      entry.count += 1;
      freq.set(key, entry);
    });

    // Bigrams (only when both words are content words — filters "years of",
    // "ability to", etc. automatically since one side is a stopword/filler).
    for (let i = 0; i < rawTokens.length - 1; i++) {
      const a = rawTokens[i];
      const b = rawTokens[i + 1];
      if (isContentWord(a) && isContentWord(b)) {
        const key = `${stem(a)} ${stem(b)}`;
        const display = `${a} ${b}`;
        const entry = freq.get(key) || { display, count: 0, isPhrase: true };
        entry.count += 1;
        freq.set(key, entry);
      }
    }

    const candidates = [];
    freq.forEach((entry, key) => {
      const isHint = SKILL_HINTS.has(entry.display) ||
        entry.display.split(" ").some(w => SKILL_HINTS.has(w));
      const qualifies = entry.count >= 2 || isHint;
      if (!qualifies) return;
      const weight = entry.count * (isHint ? 2 : 1) * (entry.isPhrase ? 1.4 : 1);
      candidates.push({ key, display: entry.display, weight });
    });

    candidates.sort((x, y) => y.weight - x.weight);
    return candidates.slice(0, 25);
  }

  function scoreResume(resumeText, keywords) {
    const resumeTokens = new Set(tokenize(resumeText).map(stem));
    const resumeNormalized = " " + normalize(resumeText) + " ";

    const matched = [];
    const missing = [];

    keywords.forEach(kw => {
      let found;
      if (kw.key.includes(" ")) {
        // Phrase: check stemmed-word membership as a loose proxy, then
        // confirm with a direct substring check on the raw phrase.
        const parts = kw.key.split(" ");
        found = parts.every(p => resumeTokens.has(p)) ||
          resumeNormalized.includes(" " + kw.display + " ");
      } else {
        found = resumeTokens.has(kw.key);
      }
      (found ? matched : missing).push(kw);
    });

    return { matched, missing };
  }

  // ---------------------------------------------------------------------
  // Freemium scan cap (soft cap only — no payment wiring yet, see
  // DOCUMENTATION.md Phase 2)
  // ---------------------------------------------------------------------

  // Local date, not UTC — the UI promises a reset "at midnight", which
  // should mean the visitor's midnight, not UTC's.
  function todayKey() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function getScanState() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      if (raw.date !== todayKey()) return { date: todayKey(), count: 0 };
      return raw;
    } catch {
      return { date: todayKey(), count: 0 };
    }
  }

  function recordScan() {
    const state = getScanState();
    state.count += 1;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return state;
  }

  function remainingScans() {
    return Math.max(0, FREE_SCANS_PER_DAY - getScanState().count);
  }

  // ---------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------

  const els = {
    jd: document.getElementById("jd"),
    resume: document.getElementById("resume"),
    checkBtn: document.getElementById("check-btn"),
    scanCounter: document.getElementById("scan-counter"),
    results: document.getElementById("results"),
    scoreRing: document.getElementById("score-ring"),
    scoreNumber: document.getElementById("score-number"),
    scoreLabel: document.getElementById("score-label"),
    matchedList: document.getElementById("matched-list"),
    missingList: document.getElementById("missing-list"),
    matchedCount: document.getElementById("matched-count"),
    missingCount: document.getElementById("missing-count"),
    limitNotice: document.getElementById("limit-notice"),
    resumeUpload: document.getElementById("resume-upload"),
    uploadStatus: document.getElementById("upload-status"),
    aiVerdictBlock: document.getElementById("ai-verdict-block"),
    aiVerdictBtn: document.getElementById("ai-verdict-btn"),
    aiVerdictOutput: document.getElementById("ai-verdict-output"),
    welcomeModal: document.getElementById("welcome-modal"),
    welcomeModalClose: document.getElementById("welcome-modal-close"),
    welcomeModalLimit: document.getElementById("welcome-modal-limit"),
  };

  function bandFor(score) {
    if (score >= 80) return { label: "Strong match", color: "var(--good)" };
    if (score >= 50) return { label: "Moderate match", color: "var(--warn)" };
    return { label: "Needs work", color: "var(--bad)" };
  }

  // Scoring counts every keyword (bigrams and their component words) so the
  // percentage rewards exact phrase matches without losing partial credit.
  // For display only, collapse a unigram chip into its bigram when both are
  // present in the same list, so "react" and "javascript react" don't both
  // show up as separate-looking chips.
  function dedupeForDisplay(items) {
    const phraseWords = new Set();
    items.forEach(item => {
      if (item.display.includes(" ")) item.display.split(" ").forEach(w => phraseWords.add(w));
    });
    return items.filter(item => item.display.includes(" ") || !phraseWords.has(item.display));
  }

  function renderList(container, items, emptyMessage) {
    container.innerHTML = "";
    if (items.length === 0) {
      const p = document.createElement("p");
      p.className = "empty-note";
      p.textContent = emptyMessage;
      container.appendChild(p);
      return;
    }
    items.forEach(item => {
      const li = document.createElement("li");
      li.textContent = item.display;
      container.appendChild(li);
    });
  }

  // Populated by renderResults, read by the AI Verdict handler — keeps the
  // AI request grounded in exactly what the visitor sees on screen.
  let lastContext = null;

  function renderResults(result, jdText, resumeText) {
    const { matched, missing } = result;

    // Score is derived from the same deduped lists shown on screen, not the
    // raw (pre-dedupe) keyword list — otherwise the % and the visible
    // matched/missing counts can silently disagree, which undermines the
    // one number this whole tool exists to be trustworthy about.
    const matchedDisplay = dedupeForDisplay(matched);
    const missingDisplay = dedupeForDisplay(missing);
    const displayTotal = matchedDisplay.length + missingDisplay.length;
    const score = displayTotal === 0 ? 0 : Math.round((matchedDisplay.length / displayTotal) * 100);
    const band = bandFor(score);

    els.scoreNumber.textContent = `${score}%`;
    els.scoreLabel.textContent = band.label;
    els.scoreRing.style.background =
      `radial-gradient(closest-side, var(--surface) 68%, transparent 69% 100%),` +
      `conic-gradient(${band.color} ${score * 3.6}deg, var(--surface-2) ${score * 3.6}deg)`;

    els.matchedCount.textContent = String(matchedDisplay.length);
    els.missingCount.textContent = String(missingDisplay.length);
    renderList(els.matchedList, matchedDisplay, "No strong keyword overlaps found yet.");
    renderList(els.missingList, missingDisplay, "Nothing missing — great coverage.");

    lastContext = {
      jdText,
      resumeText,
      score,
      matched: matchedDisplay.map(k => k.display),
      missing: missingDisplay.map(k => k.display),
    };
    els.aiVerdictOutput.hidden = true;
    els.aiVerdictOutput.textContent = "";
    els.aiVerdictBlock.hidden = !AI_VERDICT_ENDPOINT;

    els.results.hidden = false;
    els.results.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function updateScanCounter() {
    const left = remainingScans();
    els.scanCounter.textContent = `${left} free scan${left === 1 ? "" : "s"} left today`;
    els.checkBtn.disabled = left <= 0;
    els.limitNotice.hidden = left > 0;
  }

  function runCheck() {
    const jdText = els.jd.value.trim();
    const resumeText = els.resume.value.trim();

    if (!jdText || !resumeText) {
      alert("Paste both the job description and your resume first.");
      return;
    }
    if (remainingScans() <= 0) {
      updateScanCounter();
      return;
    }

    const keywords = extractKeywords(jdText);
    const result = scoreResume(resumeText, keywords);
    renderResults(result, jdText, resumeText);

    recordScan();
    updateScanCounter();
  }

  // ---------------------------------------------------------------------
  // PDF upload — parsed entirely client-side via pdf.js, file never
  // leaves the browser (see DOCUMENTATION.md privacy stance).
  // ---------------------------------------------------------------------

  // Same pinned version as the <script> tag in index.html (which carries
  // the SRI hash). This worker file is loaded via `new Worker(url)` inside
  // pdf.js itself, not a <script> tag, so SRI can't be attached here —
  // pinning the exact version is the mitigation available for this path.
  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  }

  async function handlePdfUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    if (!window.pdfjsLib) {
      els.uploadStatus.hidden = false;
      els.uploadStatus.classList.add("is-error");
      els.uploadStatus.textContent =
        "PDF upload isn't available right now (a required script failed to load). Please paste your resume text instead.";
      e.target.value = "";
      return;
    }

    els.uploadStatus.hidden = false;
    els.uploadStatus.classList.remove("is-error");
    els.uploadStatus.textContent = `Reading ${file.name}...`;

    try {
      const buf = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
      let text = "";
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map(it => it.str).join(" ") + "\n";
      }
      text = text.trim();
      if (!text) {
        throw new Error("no extractable text found — it may be a scanned image");
      }
      // maxlength on the textarea only guards typed/pasted input, not a
      // scripted .value assignment — truncate here so a huge PDF can't
      // hand the tokenizer megabytes of text and freeze the tab.
      const wasTruncated = text.length > MAX_TEXT_LENGTH;
      els.resume.value = text.slice(0, MAX_TEXT_LENGTH);
      els.uploadStatus.textContent = wasTruncated
        ? `Loaded ${file.name} — text was long and got trimmed to fit. Parsed in your browser, never uploaded anywhere.`
        : `Loaded ${file.name} — parsed in your browser, never uploaded anywhere.`;
    } catch (err) {
      els.uploadStatus.classList.add("is-error");
      els.uploadStatus.textContent =
        `Couldn't read that PDF (${err.message || "unknown error"}). Try pasting the text instead.`;
    } finally {
      e.target.value = "";
    }
  }

  // ---------------------------------------------------------------------
  // AI Verdict — the one sanctioned exception to "nothing leaves the
  // browser" (see GUIDELINES.md). Only runs when explicitly clicked, and
  // only if AI_VERDICT_ENDPOINT has been configured with a deployed proxy.
  // ---------------------------------------------------------------------

  const aiVerdictBtnDefaultHTML = els.aiVerdictBtn.innerHTML;

  async function getAiVerdict() {
    if (!lastContext) return;
    els.aiVerdictBtn.disabled = true;
    els.aiVerdictBtn.textContent = "Thinking...";
    els.aiVerdictOutput.hidden = false;
    els.aiVerdictOutput.classList.remove("is-error");
    els.aiVerdictOutput.textContent = "Contacting AI service...";

    try {
      const res = await fetch(AI_VERDICT_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(lastContext),
      });
      const data = await res.json();
      if (!res.ok || !data.verdict) {
        throw new Error(data.error || `request failed (${res.status})`);
      }
      els.aiVerdictOutput.textContent = data.verdict;
    } catch (err) {
      els.aiVerdictOutput.classList.add("is-error");
      els.aiVerdictOutput.textContent = `Couldn't get an AI verdict: ${err.message}`;
    } finally {
      els.aiVerdictBtn.disabled = false;
      els.aiVerdictBtn.innerHTML = aiVerdictBtnDefaultHTML;
    }
  }

  // ---------------------------------------------------------------------
  // Welcome popup — shown once per day (same reset cadence as the scan
  // cap) so returning same-day visitors aren't nagged repeatedly.
  // ---------------------------------------------------------------------

  let modalOpenerFocus = null;

  function closeWelcomeModal() {
    localStorage.setItem(WELCOME_KEY, todayKey());
    els.welcomeModal.hidden = true;
    // Return focus to wherever it was (or the main task) instead of
    // dropping it back to <body>, which reads as "nowhere" to a screen
    // reader after a modal closes.
    (modalOpenerFocus || els.jd).focus();
  }

  function maybeShowWelcomeModal() {
    els.welcomeModalLimit.textContent = String(FREE_SCANS_PER_DAY);
    if (localStorage.getItem(WELCOME_KEY) === todayKey()) return;
    modalOpenerFocus = document.activeElement;
    els.welcomeModal.hidden = false;
    els.welcomeModalClose.focus();
  }

  els.welcomeModalClose.addEventListener("click", closeWelcomeModal);
  els.welcomeModal.addEventListener("click", e => {
    if (e.target === els.welcomeModal) closeWelcomeModal();
  });
  document.addEventListener("keydown", e => {
    if (els.welcomeModal.hidden) return;
    if (e.key === "Escape") {
      closeWelcomeModal();
      return;
    }
    // Minimal focus trap: the modal has exactly one focusable control, so
    // Tab/Shift+Tab should just keep landing on it rather than escaping to
    // the page underneath.
    if (e.key === "Tab") {
      e.preventDefault();
      els.welcomeModalClose.focus();
    }
  });

  // ---------------------------------------------------------------------
  // Decorative background parallax — purely cosmetic, so it's skipped
  // entirely for prefers-reduced-motion rather than just slowed down.
  // ---------------------------------------------------------------------

  const bgDecor = document.querySelector(".bg-decor");
  if (bgDecor && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    let pending = false;
    window.addEventListener("mousemove", e => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        const x = e.clientX / window.innerWidth - 0.5;
        const y = e.clientY / window.innerHeight - 0.5;
        bgDecor.style.transform = `translate(${x * -24}px, ${y * -24}px)`;
        pending = false;
      });
    });
  }

  els.checkBtn.addEventListener("click", runCheck);
  els.resumeUpload.addEventListener("change", handlePdfUpload);
  els.aiVerdictBtn.addEventListener("click", getAiVerdict);
  updateScanCounter();
  maybeShowWelcomeModal();
})();
