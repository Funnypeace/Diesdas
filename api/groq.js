// /api/groq.js - Vercel API Route für GroqCloud mit optionalem Firecrawl (serverseitig)
// Kompatibel mit Frontends, die action:"chat" nutzen (z. B. dein "Groq Chat – Elegant")

export default async function handler(req, res) {
  // --- CORS & Method Guard ---
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // --- Basic Logging (sicher, ohne Secrets zu leaken) ---
  try {
    console.log('=== /api/groq hit ===');
    console.log('Method:', req.method);
    console.log('Content-Type:', req.headers['content-type']);
  } catch {}

  try {
    // --- Parse & Validate Body ---
    const {
      messages,
      action,
      model = 'llama-3.3-70b-versatile',
      temperature = 0.7,
      max_tokens = 2048,
      top_p = 1,
      stream = false,
      // optional: Firecrawl Query-String (kein Key! Der Key bleibt serverseitig in ENV)
      query
    } = req.body || {};

    if (!messages || !Array.isArray(messages) || messages.length === 0 || !action) {
      return res.status(400).json({
        error: 'Messages-Array und Action sind erforderlich',
        received: { messages: !!messages, action: !!action }
      });
    }

    // --- API Keys prüfen ---
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        error: 'API-Schlüssel nicht konfiguriert. Bitte GROQ_API_KEY in Vercel Environment Variables setzen.'
      });
    }
    if (!apiKey.startsWith('gsk_')) {
      return res.status(500).json({
        error: 'Ungültiges GROQ_API_KEY Format. Muss mit gsk_ beginnen.'
      });
    }

    // --- Optional: Firecrawl (nur wenn NICHT reiner Chat und ENV vorhanden und query übergeben) ---
    let scrapedBlocks = [];
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

        // 1) Suche
        const sr = await fetch('https://api.firecrawl.dev/v1/search', {
          method: 'POST',
          headers: fcHeaders,
          body: JSON.stringify({ query, limit: 5 })
        });

        if (!sr.ok) {
          const errTxt = await sr.text();
          console.warn('Firecrawl search error:', sr.status, errTxt);
        } else {
          const srJson = await sr.json(); // { results: [{ url, title, ...}, ...] }
          const targets = (srJson.results || [])
            .map(r => r.url)
            .filter(Boolean)
            .slice(0, 5);

          // 2) Scrape Top-URLs
          for (const url of targets) {
            try {
              const sc = await fetch('https://api.firecrawl.dev/v1/scrape', {
                method: 'POST',
                headers: fcHeaders,
                body: JSON.stringify({ url })
              });
              if (!sc.ok) {
                const t = await sc.text();
                console.warn('Firecrawl scrape error for', url, sc.status, t);
                continue;
              }
              const data = await sc.json(); // { markdown|content ... }
              const block = `- ${url}\n${(data.markdown || data.content || '').slice(0, 800)}`;
              scrapedBlocks.push(block);
            } catch (e) {
              console.warn('Firecrawl scrape exception for', url, e?.message || e);
            }
          }
        }
      } catch (e) {
        console.warn('Firecrawl overall failed:', e?.message || e);
      }
    }

    // --- Messages zusammenbauen ---
    // Für reinen Chat übernehmen wir Messages 1:1 (deine Chat-Seite sendet bereits system+user).
    // Für andere Actions ergänzen wir (nicht-invasiv) einen Systemprompt & ggf. Scrape-Blöcke.
    const fullMessages =
      action === 'chat'
        ? messages
        : [
            {
              role: 'system',
              content:
                'Du bist ein präziser, hilfreicher Assistent. Antworte auf Deutsch. Fasse Ergebnisse klar und knapp zusammen.'
            },
            ...(scrapedBlocks.length
              ? [{ role: 'user', content: `Eingangsdaten (Scrapes):\n${scrapedBlocks.join('\n\n')}` }]
              : []),
            ...messages
          ];

    // --- Request an GroqCloud ---
    const requestBody = {
      model,
      messages: fullMessages,
      max_tokens,
      temperature,
      top_p,
      stream
    };

    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!groqResponse.ok) {
      const errorData = await groqResponse.text();
      console.error('GroqCloud API Error:', groqResponse.status, errorData);
      return res.status(groqResponse.status).json({
        error: `GroqCloud API Fehler: ${groqResponse.status}`,
        details: errorData
      });
    }

    const groqData = await groqResponse.json();

    // --- Einheitliche Antwortstruktur (rückwärtskompatibel) ---
    const response = {
      content: groqData.choices?.[0]?.message?.content || 'Keine Antwort erhalten',
      usage: groqData.usage,
      model: groqData.model || model,
      action,
      timestamp: new Date().toISOString()
    };

    return res.status(200).json(response);
  } catch (error) {
    console.error('API Route Error:', error);
    return res.status(500).json({
      error: 'Interner Server-Fehler',
      details: error?.message || String(error)
    });
  }
}

// Optional: Edge Runtime (auskommentiert, wenn gewünscht)
// export const config = { runtime: 'edge' };
