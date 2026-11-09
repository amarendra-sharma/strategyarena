/* MacroNations AI instructor (Asha) for Game Theory. Own file so replacing index.html cannot remove it.
   Test course only for now; real sections are added to `courses` when the instructor decides.
   Widget code is shared with Microeconomics and loaded from there. It needs window.sb (global var in this portal) and window.State ({user, role, currentCourseId, payCourseId, teachCourseId}). */
(function () {
  try {
    if (window.__aiInstructorHook) return; window.__aiInstructorHook = true;
    var base = 'https://microeconomics.macronations.com/ai-instructor/';
    var url = 'https://qgelvmefyexyzpwqupev.supabase.co';
    var fn = url + '/functions/v1/sa-ai-instructor';
    var courses = ['5a000000-0000-4000-8000-0000000000a1'];   // Asha TEST course. Each course's own Asha settings (sa_ai_settings) still decide what is on.
    window.AI_INSTRUCTOR_CONFIG = { supabaseUrl: url, functionUrl: fn };
    window.AI_INSTRUCTOR_WIDGET = { courseIds: courses, functionUrl: fn, enrollTable: 'sa_enrollments', courseTable: 'sa_courses' };
    // staff pages look at State.teachCourseId: point it at a listed course the signed-in staff member can see
    setInterval(function () {
      try {
        var st = window.State; if (!st || !st.user || st.role === 'student') return;
        var mine = (st.courses || []).map(function (c) { return c.id; });
        var hit = courses.filter(function (id) { return mine.indexOf(id) >= 0; })[0];
        if (hit && st.teachCourseId !== hit && (st.currentCourseId === hit || !st.currentCourseId)) st.teachCourseId = hit;
      } catch (e) {}
    }, 2000);
    ['widget.js', 'teach-panel.js'].forEach(function (f) {
      var s = document.createElement('script'); s.type = 'module'; s.src = base + f + '?v=20261101b'; document.head.appendChild(s);
    });
  } catch (e) {}
})();
