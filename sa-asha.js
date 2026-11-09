/* MacroNations AI instructor (Asha) for Game Theory. Own file so replacing index.html cannot remove it.
   On for all courses; each course's sa_ai_settings row decides whether Asha is actually enabled.
   Widget and Talk voice files are served from this site (ai-instructor/): the voice workers must be same-origin. It needs window.sb (global var in this portal) and window.State ({user, role, currentCourseId, payCourseId, teachCourseId}). */
(function () {
  try {
    if (window.__aiInstructorHook) return; window.__aiInstructorHook = true;
    var base = './ai-instructor/';
    var url = 'https://qgelvmefyexyzpwqupev.supabase.co';
    var fn = url + '/functions/v1/sa-ai-instructor';
    var courses = ['*'];   // every course (current and future); the server still checks each course's own Asha settings (sa_ai_settings)
    window.AI_INSTRUCTOR_CONFIG = { supabaseUrl: url, functionUrl: fn };
    window.AI_INSTRUCTOR_WIDGET = { courseIds: courses, talkCourseIds: ['*'], functionUrl: fn, enrollTable: 'sa_enrollments', courseTable: 'sa_courses' };
    // staff pages look at State.teachCourseId: point it at a listed course the signed-in staff member can see
    setInterval(function () {
      try {
        var st = window.State; if (!st || !st.user || st.role === 'student') return;
        var mine = (st.courses || []).map(function (c) { return c.id; });
        var hit = st.currentCourseId || mine[0];
        if (hit && st.teachCourseId !== hit) st.teachCourseId = hit;
      } catch (e) {}
    }, 2000);
    ['widget.js', 'teach-panel.js'].forEach(function (f) {
      var s = document.createElement('script'); s.type = 'module'; s.src = base + f + '?v=20261101b'; document.head.appendChild(s);
    });
  } catch (e) {}
})();
