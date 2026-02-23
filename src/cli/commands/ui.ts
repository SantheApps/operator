import { Command } from 'commander';
import http from 'node:http';
import chalk from 'chalk';
import { runOperator } from '../../operator/adapter.js';

interface QueryRequestBody {
    message?: string;
    organizationId?: string;
    instanceId?: string;
}

export function createUiCommand(): Command {
    return new Command('ui')
        .description('Start a simple Operator web chat UI')
        .option('--host <host>', 'Host to bind', '127.0.0.1')
        .option('--port <port>', 'Port to bind', '8787')
        .option('--org <organizationId>', 'Default organizationId for requests')
        .option('--instance <instanceId>', 'Default instanceId for requests')
        .action(async (opts: { host: string; port: string; org?: string; instance?: string }) => {
            const host = opts.host;
            const port = Number(opts.port);

            const server = http.createServer(async (req, res) => {
                try {
                    const method = req.method ?? 'GET';
                    const url = req.url ?? '/';

                    if (method === 'GET' && url === '/health') {
                        json(res, 200, { ok: true });
                        return;
                    }

                    if (method === 'POST' && url === '/api/operator/query') {
                        const body = await readJsonBody<QueryRequestBody>(req);
                        const message = body.message?.trim() || '';
                        const organizationId = (body.organizationId || opts.org || process.env['OPERATOR_ORGANIZATION_ID'] || '').trim();
                        const instanceId = (body.instanceId || opts.instance || process.env['OPERATOR_INSTANCE_ID'] || '').trim() || undefined;

                        if (!message) {
                            json(res, 400, { success: false, error: 'message is required' });
                            return;
                        }
                        if (!organizationId) {
                            json(res, 400, {
                                success: false,
                                error: 'organizationId is required (send in request, --org option, or OPERATOR_ORGANIZATION_ID env)',
                            });
                            return;
                        }

                        const result = await runOperator({
                            message,
                            organizationId,
                            instanceId,
                            cwd: process.cwd(),
                        });

                        json(res, 200, result);
                        return;
                    }

                    if (method === 'GET' && (url === '/' || url.startsWith('/?'))) {
                        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
                        res.end(renderPage({
                            defaultOrg: opts.org || process.env['OPERATOR_ORGANIZATION_ID'] || '',
                            defaultInstance: opts.instance || process.env['OPERATOR_INSTANCE_ID'] || '',
                        }));
                        return;
                    }

                    json(res, 404, { error: 'Not found' });
                } catch (err) {
                    json(res, 500, { success: false, error: (err as Error).message });
                }
            });

            server.on('error', (err: NodeJS.ErrnoException) => {
                if (err.code === 'EADDRINUSE') {
                    console.error(chalk.red(`Port ${port} is already in use. Choose another with --port.`));
                } else {
                    console.error(chalk.red(err.message));
                }
                process.exit(1);
            });

            server.listen(port, host, () => {
                const base = `http://${host}:${port}`;
                console.log(chalk.green(`\nOperator UI running at ${base}\n`));
                console.log(chalk.dim('Use your browser to chat with tenant-scoped context.\n'));
            });
        });
}

async function readJsonBody<T>(req: http.IncomingMessage): Promise<T> {
    const chunks: Buffer[] = [];
    let bytes = 0;
    const maxBytes = 1024 * 1024;

    for await (const chunk of req) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buf.length;
        if (bytes > maxBytes) {
            throw new Error('Request body too large');
        }
        chunks.push(buf);
    }

    const raw = Buffer.concat(chunks).toString('utf-8').trim();
    if (!raw) return {} as T;
    return JSON.parse(raw) as T;
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
}

function renderPage(values: { defaultOrg: string; defaultInstance: string }): string {
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Operator</title>
  <style>
    :root{
      --bg:#0a1228;
      --panel:#111d3f;
      --panel-soft:#192a56;
      --border:#2e437f;
      --text:#eef2ff;
      --muted:#a9b8e6;
      --accent:#33d6a6;
      --danger:#ff6b6b;
    }
    *{box-sizing:border-box}
    body{
      margin:0;
      font-family: ui-sans-serif, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
      color:var(--text);
      background: radial-gradient(circle at 20% 0%, #1a2f64 0%, var(--bg) 45%);
      min-height:100vh;
    }
    .wrap{max-width:1000px;margin:0 auto;padding:24px}
    .card{
      background:linear-gradient(180deg,var(--panel),var(--panel-soft));
      border:1px solid var(--border);
      border-radius:16px;
      overflow:hidden;
      box-shadow:0 20px 50px rgba(0,0,0,.35);
    }
    .head{padding:18px 20px;border-bottom:1px solid var(--border)}
    .title{font-size:24px;font-weight:700;letter-spacing:.2px}
    .sub{color:var(--muted);margin-top:6px;font-size:14px}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:16px 20px;border-bottom:1px solid var(--border)}
    input,textarea,button{
      width:100%;
      border-radius:10px;
      border:1px solid var(--border);
      background:#0f1b3a;
      color:var(--text);
      padding:10px 12px;
      font-size:14px;
    }
    textarea{min-height:96px;resize:vertical}
    button{
      background:linear-gradient(180deg,#37d9ab,#25b88f);
      color:#04261d;
      font-weight:700;
      cursor:pointer;
      border:none;
    }
    button:disabled{opacity:.6;cursor:not-allowed}
    .chat{padding:18px 20px;display:flex;flex-direction:column;gap:12px;max-height:50vh;overflow:auto}
    .msg{
      border:1px solid var(--border);
      background:#0c1734;
      border-radius:12px;
      padding:12px;
      white-space:pre-wrap;
      line-height:1.4;
    }
    .msg.user{border-color:#2f7f6d;background:#0f2a24}
    .meta{font-size:12px;color:var(--muted);margin-bottom:6px}
    .err{color:var(--danger)}
    @media (max-width:800px){.grid{grid-template-columns:1fr}}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="head">
        <div class="title">Operator</div>
        <div class="sub">Tenant-aware chat powered by your existing Agent runtime.</div>
      </div>
      <div class="grid">
        <input id="org" placeholder="organizationId (required)" value="${escapeHtml(values.defaultOrg)}" />
        <input id="instance" placeholder="instanceId (optional)" value="${escapeHtml(values.defaultInstance)}" />
        <textarea id="message" style="grid-column:1/-1" placeholder="Ask Operator a question..."></textarea>
        <button id="send" style="grid-column:1/-1">Send</button>
      </div>
      <div id="chat" class="chat">
        <div class="msg"><div class="meta">system</div>Ready. Provide tenant context and ask your question.</div>
      </div>
    </div>
  </div>
<script>
const chat = document.getElementById('chat');
const btn = document.getElementById('send');
const message = document.getElementById('message');
const org = document.getElementById('org');
const instance = document.getElementById('instance');

function add(role, text, isErr=false){
  const div = document.createElement('div');
  div.className = 'msg ' + (role==='user' ? 'user' : '');
  div.innerHTML = '<div class="meta">' + role + '</div><div class="' + (isErr?'err':'') + '"></div>';
  div.querySelector('div:last-child').textContent = text;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

btn.addEventListener('click', async () => {
  const body = {
    message: message.value.trim(),
    organizationId: org.value.trim(),
    instanceId: instance.value.trim() || undefined
  };
  if (!body.message) return;
  add('user', body.message);
  btn.disabled = true;
  try {
    const res = await fetch('/api/operator/query', {
      method: 'POST',
      headers: {'content-type':'application/json'},
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok || data.success === false) {
      add('operator', data.error || 'Request failed', true);
    } else {
      const meta = [
        data.tenant?.organizationId ? ('org=' + data.tenant.organizationId) : '',
        data.tenant?.instanceId ? ('instance=' + data.tenant.instanceId) : '',
        data.model ? ('model=' + data.model) : ''
      ].filter(Boolean).join(' | ');
      add('operator', (meta ? '[' + meta + ']\\n\\n' : '') + (data.output || ''));
    }
  } catch (e) {
    add('operator', e.message || 'Network error', true);
  } finally {
    btn.disabled = false;
  }
});
</script>
</body>
</html>`;
}

function escapeHtml(v: string): string {
    return v
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}
