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
      // find this student's course (the shell creates a self-study course).
      return sb.from('sa_enrollments').select('course_id')
        .eq('student_id', user.id).limit(1)
        .then(function (enr) {
          var courseId = null;
          if (enr && enr.data && enr.data.length > 0) { courseId = enr.data[0].course_id; }
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
    var reported = false;
    function flush() {
      if (reported) { return; }
      var snap;
      try { snap = opts.getSession(); } catch (e) { snap = null; }
      if (!snap) { return; }                 // nothing meaningful happened — skip
      reported = true;
      var score = (snap.score !== undefined && snap.score !== null) ? snap.score : null;
      var outcome = snap.outcome ? snap.outcome : 'completed';
      var detail = snap.detail ? snap.detail : null;
      recordArena(opts.slug, score, outcome, detail);
    }
    // visibilitychange (hidden) is the most reliable "leaving" signal on mobile + desktop.
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') { flush(); }
    });
    window.addEventListener('pagehide', flush);
    // Expose a manual trigger too, for arenas that DO have an explicit "finish".
    global.SAProgress.reportArenaNow = flush;
  }

  function makeNoop(reason) {
    function noop() { return Promise.resolve(null); }
    return {
      markReadingDone: noop, recordQuiz: noop, recordArena: noop,
      logEvent: noop, isSignedIn: function () { return Promise.resolve(false); },
      initArena: function () {}, reportArenaNow: function () {},
      _disabled: reason
    };
  }

  global.SAProgress = {
    markReadingDone: markReadingDone,
    recordQuiz: recordQuiz,
    recordArena: recordArena,
    logEvent: logEvent,
    isSignedIn: isSignedIn,
    initArena: initArena,
    _client: sb
  };
})(window);
