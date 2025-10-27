// /api/groq2.js  (CommonJS für Vercel Functions ohne package.json)
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

    // --- Firecrawl: Search + Scrape ---
    let scrapedBlocks = [];
    let targets = [];
    const useFirecrawl =
      action !== 'chat' &&
      typeof query === 'string' &&
      query.trim().length > 0 &&
      !!process.env.FIRECRAWL_API_KEY;

    if (useFirecrawl) {
      try {
        const fcHeaders = {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.FIRECRAWL_API_KEY}`
        };
        
        // 1) SEARCH
        const sr = await fetch('https://api.firecrawl.dev/v1/search', {
          method: 'POST',
          headers: fcHeaders,
          body: JSON.stringify({ query, q: query, limit: 5 })
        });
        if (sr.ok) {
          const sj = await sr.json();
          const results = sj?.data?.results ?? sj?.results ?? [];
          targets = results.map(r => r.url).filter(Boolean).slice(0, 5);
        }
        
        // Fallback: direkte Quellen scrapen
        if ((!targets || !targets.length) && Array.isArray(sources) && sources.length) {
          targets = [...new Set(sources)];
        }
        
        // 2) SCRAPE mit besserer Fehlerbehandlung
        for (const url of targets) {
          try {
            const sc = await fetch('https://api.firecrawl.dev/v1/scrape', {
              method: 'POST',
              headers: fcHeaders,
              body: JSON.stringify({ 
                url, 
                formats: ['markdown'],
                onlyMainContent: true,  // Nur Hauptinhalt
                timeout: 60000 
              })
            });
            if (!sc.ok) continue;
            
            const j = await sc.json();
            const md = j?.data?.markdown ?? j?.markdown ?? j?.data?.content ?? j?.content ?? '';
            if (md.trim()) {
              scrapedBlocks.push(`SOURCE: ${url}\n${md.slice(0, 15000)}`);
            }
          } catch (e) {
            console.warn('Scrape error:', url, e?.message);
          }
        }
      } catch (e) {
        console.warn('Firecrawl failed:', e?.message);
      }
    }

    // --- Groq: Anfrage vorbereiten ---
    let groqMessages = [];
    
    // Patch-Extraktion (nicht Chat)
    if (action !== 'chat' && scrapedBlocks.length > 0) {
      const joined = scrapedBlocks.join('\n\n---\n\n');
      
      // WICHTIG: Robuster System-Prompt mit Beispiel
      const systemPrompt = `You are a structured data extraction API. Extract weapon balance patch notes from game update documentation.

CRITICAL RULES:
1. Return ONLY valid JSON, no markdown formatting, no explanations
2. If no patches found, return: {"patches":[],"message":"No patches found"}
3. Extract version numbers, dates, weapon names, and balance changes

OUTPUT FORMAT:
{
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
}

TYPES: "buff" (improvement), "nerf" (reduction), "change" (adjustment)`;

      groqMessages = [
        { role: 'system', content: systemPrompt },
        { 
          role: 'user', 
          content: `Extract all Battlefield weapon balance patches from this content. Return only JSON:\n\n${joined}` 
        }
      ];
    } 
    // Chat-Modus
    else if (action === 'chat' && Array.isArray(messages) && messages.length > 0) {
      groqMessages = messages;
    }
    // Keine Daten
    else {
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
        debug: { firecrawlUsed: useFirecrawl, query, targets, scrapedCount: 0 }
      });
    }

    // --- Groq API Call ---
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
        response_format: { type: "json_object" }  // Erzwinge JSON!
      })
    });

    if (!gr.ok) {
      const errText = await gr.text();
      return res.status(500).json({ 
        error: 'Groq request failed', 
        status: gr.status, 
        details: errText 
      });
    }

    const groqData = await gr.json();
    let content = groqData?.choices?.[0]?.message?.content?.trim?.() || '';

    // Bereinige mögliche Markdown-Blöcke
    content = content.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

    // Validiere JSON
    try {
      const parsed = JSON.parse(content);
      if (!parsed.patches) {
        parsed.patches = [];
        parsed.message = 'API returned invalid format';
      }
      content = JSON.stringify(parsed);
    } catch (e) {
      content = JSON.stringify({
        patches: [],
        message: 'Failed to parse API response',
        raw: content.slice(0, 500)
      });
    }

    return res.status(200).json({
      content,
      usage: groqData.usage,
      model: groqData.model || model,
      action,
      timestamp: new Date().toISOString(),
      debug: { 
        firecrawlUsed: useFirecrawl, 
        query, 
        targets, 
        scrapedCount: scrapedBlocks.length,
        scrapedLength: scrapedBlocks.reduce((sum, b) => sum + b.length, 0)
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
