/* ======================================================================
   sa-progress.js  —  StrategyArena shared progress reporter
   ----------------------------------------------------------------------
   ONE small module that the curriculum and every arena include. It owns:
     * the Supabase client (config in one place),
     * resolving the logged-in student + their course (same-origin session),
     * tiny helpers to record reading / quiz / arena progress.

   Because every StrategyArena file is served from the same GitHub Pages
   origin, the login session persisted by the shell (strategyarena-app.html)
   lives in localStorage that THIS file can read too — so no second login.
   If the visitor is NOT logged in, every helper simply no-ops quietly
   (so the curriculum/arenas still work standalone for anonymous readers).

   USAGE in a host file:
     <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
     <script src="sa-progress.js"></script>
     ... then call, e.g.:
     SAProgress.recordQuiz(6, 80, true);
     SAProgress.markReadingDone(6);
     SAProgress.recordArena('cooperative', 0.82, 'win', { rounds: 10 });

   No optional chaining / nullish coalescing (Safari-safe), all logic here.
   ====================================================================== */
(function (global) {
  'use strict';

  var SUPABASE_URL = 'https://qgelvmefyexyzpwqupev.supabase.co';
  var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFnZWx2bWVmeWV4eXpwd3F1cGV2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0NDY5ODAsImV4cCI6MjA5NjAyMjk4MH0.AR55GBLefKHfs9ncWWzEFks_VISPjJtbW8SezyjM3lc';

  // Guard: if the supabase-js CDN script is missing, expose no-op helpers so
  // host pages never crash.
  if (!global.supabase || !global.supabase.createClient) {
    global.SAProgress = makeNoop('supabase-js not loaded');
    return;
  }

  var sb = global.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // Cached identity, resolved once.
  var ready = null;          // a Promise resolving to { user, courseId } or null
  var ctx = null;            // resolved context once known

  function resolveContext() {
    if (ready) { return ready; }
    ready = sb.auth.getSession().then(function (res) {
      var session = (res && res.data) ? res.data.session : null;
      if (!session || !session.user) { ctx = null; return null; }
      var user = session.user;
      // Resolve the student's PRIMARY course the SAME way the app shell does, so
      // reading/quiz writes land on the course the progress view reads from.
      // Preference: a professor's course the student joined, else their self-study
      // course, else any enrollment. (The shell uses payCourseId || selfCourseId,
      // where payCourseId is the professor course when joined.)
      return sb.from('sa_enrollments').select('course_id, sa_courses(owner_id)')
        .eq('student_id', user.id)
        .then(function (enr) {
          var rows = (enr && enr.data) ? enr.data : [];
          var profCourse = null, selfCourse = null, anyCourse = null, i;
          for (i = 0; i < rows.length; i++) {
            anyCourse = rows[i].course_id;
            var oc = rows[i].sa_courses ? rows[i].sa_courses.owner_id : null;
            if (oc === user.id) { selfCourse = rows[i].course_id; }
            else if (oc && !profCourse) { profCourse = rows[i].course_id; }
          }
          var courseId = profCourse ? profCourse : (selfCourse ? selfCourse : anyCourse);
          ctx = { user: user, courseId: courseId };
          return ctx;
        });
    }).catch(function () { ctx = null; return null; });
    return ready;
  }

  // ---- Public helpers --------------------------------------------------

  // Upsert reading completion for a chapter.
  function markReadingDone(chapter) {
    return resolveContext().then(function (c) {
      if (!c || !c.courseId) { return null; }
      return sb.from('sa_chapter_progress').upsert({
        student_id: c.user.id,
        course_id: c.courseId,
        chapter: chapter,
        reading_done: true
      }, { onConflict: 'student_id,course_id,chapter' });
    }).catch(function () { return null; });
  }

  // Record a quiz result (score is 0..100 percent here; stored as 0..1 fraction).
  function recordQuiz(chapter, percent, passed) {
    return resolveContext().then(function (c) {
      if (!c || !c.courseId) { return null; }
      var frac = (typeof percent === 'number') ? (percent / 100) : null;
      return sb.from('sa_chapter_progress').upsert({
        student_id: c.user.id,
        course_id: c.courseId,
        chapter: chapter,
        quiz_score: frac,
        quiz_passed: passed === true,
        reading_done: true            // passing the chapter quiz implies it was read
      }, { onConflict: 'student_id,course_id,chapter' });
    }).catch(function () { return null; });
  }

  // Record an arena session.
  function recordArena(slug, score, outcome, detail) {
    return resolveContext().then(function (c) {
      if (!c) { return null; }
      var row = {
        student_id: c.user.id,
        course_id: c.courseId,            // may be null; column is nullable
        arena_slug: slug,
        score: (typeof score === 'number') ? score : null,
        outcome: outcome ? String(outcome) : null,
        detail: detail ? detail : null
      };
      return sb.from('sa_arena_results').insert(row);
    }).catch(function () { return null; });
  }

  // Lightweight telemetry event (optional; feeds the concept-mastery heatmap).
  function logEvent(eventType, fields) {
    return resolveContext().then(function (c) {
      if (!c) { return null; }
      var row = { student_id: c.user.id, course_id: c.courseId, event_type: String(eventType) };
      if (fields) {
        if (fields.chapter !== undefined) { row.chapter = fields.chapter; }
        if (fields.concept_tag !== undefined) { row.concept_tag = fields.concept_tag; }
        if (fields.value_num !== undefined) { row.value_num = fields.value_num; }
        if (fields.detail !== undefined) { row.detail = fields.detail; }
      }
      return sb.from('sa_telemetry').insert(row);
    }).catch(function () { return null; });
  }

  // Is someone logged in? (resolves to boolean) — handy for host UIs.
  function isSignedIn() {
    return resolveContext().then(function (c) { return !!c; });
  }

  // ---- Universal arena session auto-reporter ---------------------------
  // An arena calls SAProgress.initArena({ slug, getSession }) once at load.
  //   slug       : the arena's slug (e.g. 'cooperative')
  //   getSession : a function returning { score, outcome, detail } at any time,
  //                reading from that arena's own State. May return null if the
  //                student never actually engaged (we skip empty sessions).
  // We report exactly once, when the page is hidden/closed, so it works for
  // both match-style and open-ended explorer arenas without bespoke hooks.
  function initArena(opts) {
    if (!opts || !opts.slug || typeof opts.getSession !== 'function') { return; }
    var recorded = false;     // ensure AT MOST ONE row per arena session

    // Record the LATEST meaningful session exactly once. Called at leave-time or
    // via an explicit finish trigger -- NOT on a per-round interval, so a 10-round
    // game produces a single result row (its final score), not one row per round.
    function flush() {
      if (recorded) { return; }
      var snap;
      try { snap = opts.getSession(); } catch (e) { snap = null; }
      if (!snap) { return; }                 // nothing meaningful yet — skip
      recorded = true;
      var score = (snap.score !== undefined && snap.score !== null) ? snap.score : null;
      var outcome = snap.outcome ? snap.outcome : 'completed';
      var detail = snap.detail ? snap.detail : null;
      recordArena(opts.slug, score, outcome, detail);
    }

    // Record when the player leaves the arena (best effort) OR when the game
    // explicitly signals completion via SAProgress.reportArenaNow(). We do NOT
    // poll during play: polling recorded a fresh row every time the score
    // changed, so a single match created many rows.
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') { flush(); }
    });
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    // Explicit "match complete" trigger the game can call for a reliable, timely
    // single write (recommended: call SAProgress.reportArenaNow() at match end).
    global.SAProgress.reportArenaNow = flush;
  }

  function makeNoop(reason) {
    function noop() { return Promise.resolve(null); }
    return {
      markReadingDone: noop, recordQuiz: noop, recordArena: noop,
      logEvent: noop, isSignedIn: function () { return Promise.resolve(false); },
      initArena: function () {}, reportArenaNow: function () {},
      trackReading: function () {}, _disabled: reason
    };
  }

  /* ====================================================================
     READING ENFORCEMENT
     --------------------------------------------------------------------
     Reading completion is EARNED, not self-declared. A chapter only counts
     as read when the student has genuinely gone through it:
       (1) COVERAGE: every section of the chapter must actually scroll into
           view (tracked per-section via IntersectionObserver). Jumping to
           the bottom does not reveal the middle sections, so it fails.
       (2) DWELL: cumulative *active* time on the chapter must reach a floor
           scaled to the chapter's length (you cannot read a 20-min chapter
           in 30 seconds). Time only accrues while the tab is visible.
     Only when BOTH are satisfied do we call markReadingDone(chapter).
     A small floating indicator shows live progress so the student knows
     what remains. Caller invokes SAProgress.trackReading(chapterEl, n, mins).
     ==================================================================== */
  var _activeTracker = null;

  function trackReading(chapterEl, chapterNum, estMinutes) {
    if (!chapterEl || !chapterNum) { return; }
    // Tear down any tracker from a previously-viewed chapter.
    if (_activeTracker && _activeTracker.teardown) { _activeTracker.teardown(); }

    // Sections to cover: every chapter uses <h2 class="section-title"> for its
    // sections (verified uniform across all 14 chapters), with <h3> subsections in
    // the richer chapters. h2+h3 gives accurate per-section coverage; we fall back
    // to sampled content blocks only if a chapter somehow has too few headings.
    var sections = [].slice.call(chapterEl.querySelectorAll('h2, h3'));
    if (sections.length < 2) {
      sections = [].slice.call(chapterEl.querySelectorAll('p, .cnl-section, .chapter-quiz')).filter(function (el, i) {
        return i % 3 === 0; // sample blocks as checkpoints when no headings
      });
    }
    var totalSections = sections.length > 0 ? sections.length : 1;

    // Dwell floor: at least 35% of the stated read time, min 45s, capped at 12min,
    // so it is meaningful but never punitive for fast readers.
    var mins = (typeof estMinutes === 'number' && estMinutes > 0) ? estMinutes : 6;
    var floorMs = Math.max(45000, Math.min(12 * 60000, Math.round(mins * 60000 * 0.35)));

    var seen = {};              // index -> true once the section has been viewed
    var seenCount = 0;
    var activeMs = 0;
    var lastTick = Date.now();
    var done = false;
    var recorded = false;

    // ---- live indicator ----
    var ind = document.createElement('div');
    ind.setAttribute('data-sa-reading-indicator', '1');
    ind.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:99999;background:#1b1340;color:#F0EEFA;border:1px solid rgba(155,123,255,.4);border-radius:12px;padding:10px 13px;font:12.5px/1.4 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.35);max-width:230px;';
    document.body.appendChild(ind);
    function pct(x) { return Math.max(0, Math.min(100, Math.round(x * 100))); }
    function paint() {
      if (done) {
        ind.innerHTML = '<b style="color:#34d399;">\u2713 Chapter ' + chapterNum + ' read</b><div style="opacity:.8;margin-top:2px;">Progress saved.</div>';
        return;
      }
      var cov = seenCount / totalSections;
      var dwell = activeMs / floorMs;
      ind.innerHTML =
        '<b>Reading Chapter ' + chapterNum + '</b>' +
        '<div style="margin-top:6px;">Sections viewed: ' + seenCount + ' / ' + totalSections + '</div>' +
        '<div style="height:5px;background:rgba(255,255,255,.12);border-radius:3px;margin:3px 0 6px;overflow:hidden;"><div style="height:100%;width:' + pct(cov) + '%;background:#9B7BFF;"></div></div>' +
        '<div>Time on chapter: ' + pct(dwell) + '%</div>' +
        '<div style="height:5px;background:rgba(255,255,255,.12);border-radius:3px;margin:3px 0 0;overflow:hidden;"><div style="height:100%;width:' + pct(dwell) + '%;background:#FBBF24;"></div></div>';
    }

    function maybeComplete() {
      if (done) { return; }
      if (seenCount >= totalSections && activeMs >= floorMs) {
        done = true;
        paint();
        if (!recorded) {
          recorded = true;
          markReadingDone(chapterNum);   // the enforced write
        }
        // keep the checkmark visible briefly, then fade
        setTimeout(function () { if (ind && ind.parentNode) { ind.style.transition = 'opacity .6s'; ind.style.opacity = '0'; setTimeout(function(){ if(ind.parentNode){ ind.parentNode.removeChild(ind); } }, 700); } }, 4000);
      }
    }

    // ---- coverage via IntersectionObserver ----
    var io = null;
    if (typeof IntersectionObserver !== 'undefined') {
      io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            var idx = sections.indexOf(e.target);
            if (idx >= 0 && !seen[idx]) { seen[idx] = true; seenCount++; paint(); maybeComplete(); }
          }
        });
      }, { threshold: 0.6 });   // 60% of the section must be visible to count
      sections.forEach(function (el) { io.observe(el); });
    } else {
      // No IO support: fall back to a scroll-bottom + dwell check.
      seenCount = totalSections; // can't track per-section; rely on dwell only
    }

    // ---- dwell timer (only counts while tab visible) ----
    var timer = setInterval(function () {
      var now = Date.now();
      if (document.visibilityState === 'visible') { activeMs += (now - lastTick); }
      lastTick = now;
      paint();
      maybeComplete();
    }, 1000);
    function onVis() { lastTick = Date.now(); }
    document.addEventListener('visibilitychange', onVis);

    paint();

    _activeTracker = {
      teardown: function () {
        if (io) { io.disconnect(); }
        clearInterval(timer);
        document.removeEventListener('visibilitychange', onVis);
        if (ind && ind.parentNode) { ind.parentNode.removeChild(ind); }
        _activeTracker = null;
      }
    };
  }

  global.SAProgress = {
    markReadingDone: markReadingDone,
    recordQuiz: recordQuiz,
    recordArena: recordArena,
    logEvent: logEvent,
    isSignedIn: isSignedIn,
    initArena: initArena,
    trackReading: trackReading,
    _client: sb
  };
})(window);
