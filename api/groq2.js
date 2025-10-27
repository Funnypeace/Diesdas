// /api/groq2.js  — Debug‑optimierte Version für Vercel (Node)
// - Ausführliche Fehler- und Debug-Ausgaben
// - Saubere CORS-Unterstützung (OPTIONS)
// - Robuste Body-Verarbeitung (String/Objekt)
// - Healthcheck via GET
// ENV: GROQ_API_KEY (required for Groq), FIRECRAWL_API_KEY (optional), DEBUG_GROQ2=1 (optional)

const DEBUG = process.env.DEBUG_GROQ2 === '1';

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function sendJSON(res, status, obj) {
  setCORS(res);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const payload = JSON.stringify(obj, null, 2);
  return res.status(status).end(payload);
}

function safeParseBody(req) {
  // Vercel liefert req.body je nach Content-Type als Objekt oder String
  let body = req.body;
  if (Buffer.isBuffer(body)) body = body.toString('utf8');
  if (typeof body === 'string' && body.trim().length) {
    try { body = JSON.parse(body); } catch { /* bleibt String */ }
  }
  return body && typeof body === 'object' ? body : {};
}

module.exports = async function handler(req, res) {
  try {
    setCORS(res);

    if (req.method === 'OPTIONS') {
      // Preflight
      return res.status(204).end();
    }

    if (req.method === 'GET') {
      // Lightweight health check
      return sendJSON(res, 200, {
        ok: true,
        message: 'groq2 health ok',
        env: {
          hasGroqKey: Boolean(process.env.GROQ_API_KEY),
          hasFirecrawlKey: Boolean(process.env.FIRECRAWL_API_KEY),
          debug: DEBUG
        },
        timestamp: new Date().toISOString()
      });
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST, OPTIONS');
      return sendJSON(res, 405, { error: 'Method Not Allowed' });
    }

    const b = safeParseBody(req);

    const {
      messages = [],
      action = 'chat',
      model = 'llama-3.3-70b-versatile',
      temperature = 0.2,
      top_p = 1,
      max_tokens = 1200,
      stream = false, // Streaming in dieser Demo deaktiviert
      query = '',
      sources = []
    } = b;

    const startTs = Date.now();

    const debug = {
      request: { action, model, temperature, top_p, max_tokens, stream, queryLen: (query||'').length, messagesCount: Array.isArray(messages) ? messages.length : 0 },
      env: { hasGroqKey: Boolean(process.env.GROQ_API_KEY), hasFirecrawlKey: Boolean(process.env.FIRECRAWL_API_KEY), debug: DEBUG },
      firecrawl: { used: false, targets: [], scrapedCount: 0, errors: [] },
      timings: {}
    };

    if (!process.env.GROQ_API_KEY) {
      return sendJSON(res, 500, { error: 'Missing GROQ_API_KEY environment variable', debug });
    }

    // ------------------------ Firecrawl (optional) ------------------------
    let scrapedBlocks = [];
    try {
      const useFirecrawl = action !== 'chat' && (
        (typeof query === 'string' && query.trim().length > 0) || (Array.isArray(sources) && sources.length > 0)
      ) && !!process.env.FIRECRAWL_API_KEY;

      debug.firecrawl.used = useFirecrawl;

      if (useFirecrawl) {
        const t0 = Date.now();
        const fcHeaders = {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.FIRECRAWL_API_KEY}`
        };

        let targets = [];
        if (query && query.trim().length) {
          try {
            const sr = await fetch('https://api.firecrawl.dev/v1/search', {
              method: 'POST', headers: fcHeaders, body: JSON.stringify({ query, q: query, limit: 5 })
            });
            if (sr.ok) {
              const sj = await sr.json();
              const results = sj?.data?.results ?? sj?.results ?? [];
              targets = results.map(r => r.url).filter(Boolean).slice(0, 5);
            } else {
              debug.firecrawl.errors.push(`search ${sr.status}: ${await sr.text()}`);
            }
          } catch (e) {
            debug.firecrawl.errors.push('search exception: ' + (e?.message || e));
          }
        }

        if ((!targets || !targets.length) && Array.isArray(sources) && sources.length) {
          targets = [...new Set(sources)];
        }

        for (const url of targets) {
          try {
            const sc = await fetch('https://api.firecrawl.dev/v1/scrape', {
              method: 'POST', headers: fcHeaders, body: JSON.stringify({ url, formats: ['markdown'], timeout: 60000 })
            });
            if (!sc.ok) {
              debug.firecrawl.errors.push(`scrape ${url} -> ${sc.status}: ${await sc.text()}`);
              continue;
            }
            const j = await sc.json();
            const md = j?.data?.markdown ?? j?.markdown ?? j?.data?.content ?? j?.content ?? '';
            if (md && md.trim()) scrapedBlocks.push(`- ${url}\n${md.slice(0, 12000)}`);
          } catch (e) {
            debug.firecrawl.errors.push(`scrape ${url} exception: ${e?.message || e}`);
          }
        }
        debug.firecrawl.targets = targets;
        debug.firecrawl.scrapedCount = scrapedBlocks.length;
        debug.timings.firecrawlMs = Date.now() - t0;
      }
    } catch (e) {
      debug.firecrawl.errors.push('firecrawl top-level: ' + (e?.message || e));
    }

    // ------------------------ Groq Request ------------------------
    const sys = 'Fasse die wichtigsten heutigen Nachrichten zusammen. Sei präzise, neutral und vermeide Ausschmückungen.';

    let groqMessages;
    if (scrapedBlocks.length > 0) {
      groqMessages = [
        { role: 'system', content: sys },
        { role: 'user', content: `Quelleninhalte (Auszug):\n\n${scrapedBlocks.join('\n\n---\n\n')}` }
      ];
    } else if (Array.isArray(messages) && messages.length) {
      groqMessages = messages;
    } else {
      // Nichts zu tun
      return sendJSON(res, 200, {
        content: 'Keine Eingangsdaten vorhanden (weder messages noch Firecrawl-Inhalte).',
        debug,
        timestamp: new Date().toISOString()
      });
    }

    const tGroq = Date.now();
    const gr = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
      },
      body: JSON.stringify({ model, temperature, top_p, max_tokens, stream: false, messages: groqMessages })
    });

    debug.timings.groqHttpStatus = gr.status;

    if (!gr.ok) {
      const errText = await gr.text().catch(() => '(body read error)');
      debug.timings.groqMs = Date.now() - tGroq;
      return sendJSON(res, 502, { error: 'Groq request failed', status: gr.status, details: errText, debug });
    }

    let groqData;
    try {
      groqData = await gr.json();
    } catch (e) {
      debug.timings.groqMs = Date.now() - tGroq;
      return sendJSON(res, 500, { error: 'Groq JSON parse failed', details: e?.message || String(e), debug });
    }

    debug.timings.groqMs = Date.now() - tGroq;
    debug.timings.totalMs = Date.now() - startTs;

    const content = groqData?.choices?.[0]?.message?.content?.trim?.() || '';

    return sendJSON(res, 200, {
      ok: true,
      content: content || 'Keine Antwort erhalten',
      usage: groqData?.usage,
      model: groqData?.model || model,
      action,
      debug,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    return sendJSON(res, 500, {
      error: 'Internal Server Error',
      details: err?.message || String(err),
      stack: DEBUG ? (err?.stack || null) : undefined,
      timestamp: new Date().toISOString()
    });
  }
};
