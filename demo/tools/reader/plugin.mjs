// Dev-server middleware for the dialogue reader (/reader.html, SPEC "Dialogue reader and notes (dev only)").
// Serve mode only (`apply: 'serve'`): never part of a build.
//   GET  /__reader/notes?npc=<id>          -> demo/dialogue_notes/<id>.md, or 404
//   POST /__reader/notes/stub {npc,id,chain} -> appends "## <id>" (or "## chain <id>") unless present; creates the file
//   GET  /__reader/head?npc=<id>           -> `git show HEAD:demo/public/content/dialogue/<id>.csv`, or 404
// Every answer carries `x-reader: 1`, so the page can tell the middleware from Vite's index.html fallback.
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';

const ID = /^[A-Za-z0-9_]+$/;

export function notesHeader(npc) {
  return `<!-- Dialogue notes for ${npc} (SPEC "Dialogue reader and notes (dev only)"; format in dialogue_notes/README.md).
     "## <rowId>" = a note on one row, "## chain <openerId>" = a note on a whole conversation.
     Quoted text is wording to use as written; unquoted text is direction to the rewriting agent. -->
`;
}

/** @param {{ demoDir: string }} opts */
export function readerPlugin({ demoDir }) {
  const notesDir = join(demoDir, 'dialogue_notes');
  const dialogueDir = join(demoDir, 'public', 'content', 'dialogue');
  const repoRoot = resolve(demoDir, '..');
  const npcOk = (npc) => typeof npc === 'string' && ID.test(npc) && existsSync(join(dialogueDir, `${npc}.csv`));
  const notesFile = (npc) => {
    const p = resolve(notesDir, `${npc}.md`);
    if (!p.startsWith(notesDir + '/')) throw new Error('outside dialogue_notes');
    return p;
  };
  const send = (res, code, body, type = 'text/plain; charset=utf-8') => {
    res.statusCode = code;
    res.setHeader('content-type', type);
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-reader', '1');
    res.end(body);
  };
  return {
    name: 'gv-reader-notes',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__reader', (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://x');
        try {
          if (req.method === 'GET' && url.pathname === '/notes') {
            const npc = url.searchParams.get('npc');
            if (!npcOk(npc)) return send(res, 400, 'unknown npc');
            const f = notesFile(npc);
            return existsSync(f) ? send(res, 200, readFileSync(f, 'utf8'), 'text/markdown; charset=utf-8') : send(res, 404, 'no notes');
          }
          if (req.method === 'POST' && url.pathname === '/notes/stub') {
            let body = '';
            req.on('data', (c) => { body += c; if (body.length > 10000) req.destroy(); });
            req.on('end', () => {
              let j;
              try { j = JSON.parse(body); } catch { return send(res, 400, 'bad json'); }
              const { npc, id, chain } = j ?? {};
              if (!npcOk(npc)) return send(res, 400, 'unknown npc');
              if (typeof id !== 'string' || !ID.test(id)) return send(res, 400, 'bad id');
              const heading = `## ${chain ? 'chain ' : ''}${id}`;
              const f = notesFile(npc);
              mkdirSync(notesDir, { recursive: true });
              if (!existsSync(f)) writeFileSync(f, notesHeader(npc));
              const text = readFileSync(f, 'utf8');
              const present = text.split(/\r?\n/).some((l) => l.trim() === heading);
              if (!present) appendFileSync(f, `${text.endsWith('\n') ? '' : '\n'}\n${heading}\n\n`);
              return send(res, 200, JSON.stringify({ heading, added: !present, file: `dialogue_notes/${npc}.md` }), 'application/json');
            });
            return;
          }
          if (req.method === 'GET' && url.pathname === '/head') {
            const npc = url.searchParams.get('npc');
            if (!npcOk(npc)) return send(res, 400, 'unknown npc');
            const git = spawn('git', ['show', `HEAD:demo/public/content/dialogue/${npc}.csv`], { cwd: repoRoot });
            const out = [];
            git.stdout.on('data', (c) => out.push(c));
            git.on('error', () => send(res, 500, 'git failed'));
            git.on('close', (code) => code === 0 ? send(res, 200, Buffer.concat(out), 'text/csv; charset=utf-8') : send(res, 404, 'not in HEAD'));
            return;
          }
        } catch (e) {
          return send(res, 500, String(e?.message ?? e));
        }
        next();
      });
    },
  };
}
