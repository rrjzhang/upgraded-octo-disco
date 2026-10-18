// Shared host bridge for Great Vote window modules.
// Host -> module: {type:'init', payload:{day, actions, wallet, condition, content}}, {type:'state', payload:{actions, wallet, ok}}
// Module -> host: {type:'earn', amount}, {type:'spend', actions}, {type:'submit', answers}, {type:'close'}
(function () {
  const listeners = { init: [], state: [] };
  const inFrame = window.parent && window.parent !== window;
  let gotInit = false;
  window.addEventListener('message', (e) => {
    if (inFrame && e.source !== window.parent) return;
    const m = e.data;
    if (!m || typeof m !== 'object') return;
    if (m.type === 'init') { gotInit = true; listeners.init.forEach((f) => f(m.payload || {})); }
    if (m.type === 'state') listeners.state.forEach((f) => f(m.payload || {}));
  });
  const standalone = { actions: 8, wallet: 0 };
  window.GV = {
    inFrame,
    /** The cost symbol: one amber dot per action, hidden from assistive tech (pair it with words). */
    costDots(n) {
      const dots = document.createElement('span');
      dots.className = 'cost'; dots.setAttribute('aria-hidden', 'true');
      for (let i = 0; i < n; i++) { const d = document.createElement('span'); d.className = 'cost-dot'; dots.append(d); }
      return dots;
    },
    /** Fills a button with its label plus the cost dots; the accessible name keeps the cost in words. */
    costLabel(btn, label, n) {
      btn.replaceChildren(label, GV.costDots(n));
      const words = `${n} action${n === 1 ? '' : 's'}`;
      btn.setAttribute('aria-label', `${label} (${words})`);
      btn.title = words;
      return btn;
    },
    on(type, f) { listeners[type].push(f); },
    send(msg) {
      if (inFrame) { window.parent.postMessage(msg, location.origin); return; }
      // Standalone preview: emulate the host enough to click through.
      console.info('[module] would send', msg);
      if (msg.type === 'spend') {
        const ok = standalone.actions >= msg.actions;
        if (ok) standalone.actions -= msg.actions;
        setTimeout(() => listeners.state.forEach((f) => f({ ...standalone, ok })), 0);
      }
      if (msg.type === 'earn') standalone.wallet += msg.amount;
    },
    /** Calls f with a demo payload if no init arrives (module opened directly). */
    fallback(payload) {
      if (inFrame) return; // inside the game the host always sends init
      setTimeout(() => { if (!gotInit) listeners.init.forEach((f) => f({ ...standalone, condition: 'enforcement', ...payload })); }, 50);
    },
  };
})();
