// Placeholder until the task lands; see CONTRACT.md.
window.GV_TASKS = window.GV_TASKS || {};
window.GV_TASKS.aut = {
  id: 'aut', title: 'Task aut', blurb: 'This task is not written yet. The shift ends after a few seconds.', seconds: 5,
  run(root, ctx, done) {
    const cd = ctx.countdown(5, () => done({ summary: 'Nothing to do yet.', score: null, responses: [] }));
    root.append(ctx.el('p', { className: 'prompt', textContent: 'Placeholder task aut.' }), cd.el);
    return { stop: cd.stop };
  },
};
