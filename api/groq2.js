// /api/groq2.js (CommonJS für Vercel Functions ohne package.json)

// ENV: GROQ_API_KEY, FIRECRAWL_API_KEY

module.exports = async function (req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  try {
    const {
      messages = [],
      action = 'news_summary',
      model = 'llama-3.3-70b-versatile',
      temperature = 0.2,
      top_p = 1,
      max_tokens = 1200,
      stream = false,
      query = '',
      sources = []
    } = req.body || {};

    // 1. Default-Quelle + Default-Query wenn nix gesetzt
    const defaultSources = ["https://patchbot.io/games/battlefield-6"];
    const mySources = Array.isArray(sources) && sources.length ? sources : defaultSources;
    const effectiveQuery = query && query.trim().length ? query : 'Battlefield 6 Patch Notes';

    // 2. Firecrawl-Mechanik
    let scrapedBlocks = [];
    let targets = [];
    let fcErrors = [];
    const useFirecrawl =
      action !== 'chat' && typeof effectiveQuery === 'string' && effectiveQuery.length > 0 && !!process.env.FIRECRAWL_API_KEY;

    if (useFirecrawl) {
      try {
        const fcHeaders = {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.FIRECRAWL_API_KEY}`
        };
        // SEARCH
        const sr = await fetch('https://api.firecrawl.dev/v1/search', {
          method: 'POST',
          headers: fcHeaders,
          body: JSON.stringify({ query: effectiveQuery, q: effectiveQuery, limit: 5 })
        });
        if (sr.ok) {
          const sj = await sr.json();
          const results = sj?.data?.results ?? sj?.results ?? [];
          targets = results.map(r => r.url).filter(Boolean).slice(0, 5);
        } else {
          fcErrors.push("Firecrawl-Search HTTP Error: "+sr.status);
        }
        // Fallback, falls keine Targets gefunden, auf direkte Quellen
        if ((!targets || !targets.length) && Array.isArray(mySources) && mySources.length) {
          targets = [...new Set(mySources)];
        }
        // SCRAPE jede Target-URL nacheinander
        for (const url of targets) {
          try {
            const sc = await fetch('https://api.firecrawl.dev/v1/scrape', {
              method: 'POST',
              headers: fcHeaders,
              body: JSON.stringify({
                url,
                formats: ['markdown'],
                onlyMainContent: true,
                timeout: 60000
              })
            });
            if (!sc.ok) { fcErrors.push(`Firecrawl Scrape HTTP Error: ${sc.status} for ${url}`); continue; }
            const j = await sc.json();
            const md = j?.data?.markdown ?? j?.markdown ?? j?.data?.content ?? j?.content ?? '';
            if (md.trim()) {
              scrapedBlocks.push(`SOURCE: ${url}\n${md.slice(0, 15000)}`);
            } else {
              fcErrors.push(`Leerer Scrape-Content für: ${url}`);
            }
          } catch (e) {
            fcErrors.push(`Scrape error for ${url}: ${String(e && e.message || e)}`);
          }
        }
      } catch (e) {
        fcErrors.push(`Firecrawl failed: ${String(e && e.message || e)}`);
      }
    } else if (Array.isArray(mySources) && mySources.length) {
      // Nur Direkt-Scrape (selten benötigt, aber als fallback)
      try {
        const fcHeaders = {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.FIRECRAWL_API_KEY}`
        };
        targets = [...new Set(mySources)];
        for (const url of targets) {
          const sc = await fetch('https://api.firecrawl.dev/v1/scrape', {
            method: 'POST',
            headers: fcHeaders,
            body: JSON.stringify({
              url,
              formats: ['markdown'],
              onlyMainContent: true,
              timeout: 60000
            })
          });
          if (!sc.ok) { fcErrors.push(`Firecrawl Scrape HTTP Error: ${sc.status} for ${url}`); continue; }
          const j = await sc.json();
          const md = j?.data?.markdown ?? j?.markdown ?? j?.data?.content ?? j?.content ?? '';
          if (md.trim()) {
            scrapedBlocks.push(`SOURCE: ${url}\n${md.slice(0, 15000)}`);
          } else {
            fcErrors.push(`Leerer Scrape-Content für: ${url}`);
          }
        }
      } catch (e) {
        fcErrors.push(`Direct scrape error: ${String(e && e.message || e)}`);
      }
    }

    // 3. Groq Prompt & Aufruf
    let groqMessages = [];
    let promptInput = "";

    if (action !== 'chat' && scrapedBlocks.length > 0) {
      promptInput = scrapedBlocks.join('\n\n---\n\n');
      // Robuster System-Prompt mit Beispiel/Format
      const systemPrompt = `You are a structured data extraction API. Extract weapon balance patch notes from game update documentation.

CRITICAL RULES:

1. Return ONLY valid JSON, no markdown formatting, no explanations
2. If no patches found, return: {"patches":[],"message":"No patches found"}
3. Extract version numbers, dates, weapon names, balance changes

OUTPUT FORMAT:

"patches": [
  {
    "version": "1.2.3",
    "date": "2025-10-15",
    "link": "https://...",
    "notes": "Brief summary",
    "changes": [
      {"weapon": "M4A1", "type": "nerf", "change": "Recoil increased by 10%"},
      {"weapon": "AK-47", "type": "buff", "change": "Damage increased from 30 to 35"}
    ]
  }
]
// TYPES: "buff" (improvement), "nerf" (reduction), "change" (adjustment)`;

      groqMessages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Extract all Battlefield weapon balance patches from this content. Return only JSON:\n\n${promptInput}` }
      ];
    } else if (action === 'chat' && Array.isArray(messages) && messages.length > 0) {
      groqMessages = messages;
    } else {
      return res.status(200).json({
        content: JSON.stringify({
          patches: [],
          message: scrapedBlocks.length === 0
            ? 'Keine Daten von Firecrawl erhalten. Möglicherweise keine News verfügbar.'
            : 'Keine Eingangsdaten.'
        }),
        model,
        action,
        timestamp: new Date().toISOString(),
        debug: { firecrawlUsed: useFirecrawl, effectiveQuery, query, targets, scrapedCount: 0, errors: fcErrors }
      });
    }

    // 4. Groq API Call
    let groqApiError = null;
    let groqApiResult = null;
    try {
      const gr = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
        },
        body: JSON.stringify({
          model,
          temperature,
          top_p,
          max_tokens,
          stream: false,
          messages: groqMessages,
          response_format: { type: "json_object" }
        })
      });

      if (!gr.ok) {
        const errText = await gr.text();
        groqApiError = { status: gr.status, error: errText };
      } else {
        groqApiResult = await gr.json();
      }
    } catch (e) {
      groqApiError = { ex: String(e && e.message || e) };
    }

    let content = "";
    if (groqApiResult) {
      content = groqApiResult?.choices?.[0]?.message?.content?.trim?.() || '';
      content = content.replace(/``````\s*/g, '').trim();
      try {
        const parsed = JSON.parse(content);
        if (!parsed.patches) {
          parsed.patches = [];
          parsed.message = 'API returned invalid format';
          content = JSON.stringify(parsed);
        }
      } catch (e) {
        content = JSON.stringify({
          patches: [],
          message: 'Failed to parse API response',
          raw: content.slice(0, 500)
        });
      }
    } else {
      // Groq-API-Fehler
      content = JSON.stringify({
        patches: [],
        message: 'Groq-API-Fehler',
        groqApiError
      });
    }

    return res.status(200).json({
      content,
      usage: groqApiResult?.usage,
      model: groqApiResult?.model || model,
      action,
      timestamp: new Date().toISOString(),
      debug: {
        firecrawlUsed: useFirecrawl,
        effectiveQuery,
        query,
        targets,
        scrapedCount: scrapedBlocks.length,
        scrapedLength: scrapedBlocks.reduce((sum, b) => sum + b.length, 0),
        errors: fcErrors,
        promptInput: promptInput.length ? promptInput.slice(0, 1000) + (promptInput.length > 1000 ? ' ... [gekürzt]' : '') : undefined,
        groqApiError
      }
    });
  } catch (err) {
    console.error('API /api/groq2 error:', err);
    return res.status(500).json({
      error: 'Internal Server Error',
      details: String(err?.message || err)
    });
  }
};
