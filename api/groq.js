// /api/groq.js
// Next.js / Vercel Serverless‑Funktion für News‑Zusammenfassungen
// Nutzt Firecrawl (Search + Scrape) serverseitig und Groq für die 3‑Satz‑Summary.
// ENV: GROQ_API_KEY, FIRECRAWL_API_KEY

export const config = { api: { bodyParser: true } };

export default async function handler(req, res) {
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
      max_tokens = 300,
      stream = false,
      query = '',               // z. B. (site:welt.de wirtschaft) OR (site:tagesschau.de wirtschaft)
      sources = []              // optionale URL-/Domainliste als Fallback fürs Scrapen
    } = req.body || {};

    // --- Firecrawl: Search + Scrape (nur wenn query vorhanden und kein Chat) ---
    let scrapedBlocks = [];
    let targets = [];
    const useFirecrawl = (
      action !== 'chat' &&
      typeof query === 'string' && query.trim().length > 0 &&
      !!process.env.FIRECRAWL_API_KEY
    );

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
          // manche Deploys erwarten "query", andere "q" – sende beides
          body: JSON.stringify({ query, q: query, limit: 5 })
        });

        if (sr.ok) {
          const sj = await sr.json();
          const results = sj?.data?.results ?? sj?.results ?? [];
          targets = results.map(r => r.url).filter(Boolean).slice(0, 5);
        } else {
          console.warn('Firecrawl search error:', sr.status, await sr.text());
        }

        // Fallback: direkte Quellen scrapen, wenn Search nichts liefert
        if ((!targets || !targets.length) && Array.isArray(sources) && sources.length) {
          targets = [...new Set(sources)];
        }

        // 2) SCRAPE
        for (const url of targets) {
          try {
            const sc = await fetch('https://api.firecrawl.dev/v1/scrape', {
              method: 'POST',
              headers: fcHeaders,
              body: JSON.stringify({ url, formats: ['markdown'], timeout: 60000 })
            });
            if (!sc.ok) {
              console.warn('Firecrawl scrape error for', url, sc.status, await sc.text());
              continue;
            }
            const j = await sc.json();
            const md = j?.data?.markdown ?? j?.markdown ?? j?.data?.content ?? j?.content ?? '';
            if (md.trim()) scrapedBlocks.push(`- ${url}\n${md.slice(0, 12000)}`);
          } catch (e) {
            console.warn('Firecrawl scrape exception for', url, e?.message || e);
          }
        }
      } catch (e) {
        console.warn('Firecrawl overall failed:', e?.message || e);
      }
    }

    // --- Groq: Anfrage vorbereiten ---
    const systemInstruction = 'Fasse die wichtigsten heutigen Nachrichten in höchstens drei Sätzen zusammen. Sei präzise, neutral und vermeide Ausschmückungen.';

    // Wenn wir nichts gescraped haben UND keine Chat‑Nachrichten da sind → kurzer Early‑Return
    if (scrapedBlocks.length === 0 && (!Array.isArray(messages) || messages.length === 0)) {
      return res.status(200).json({
        content: 'Keine relevanten Nachrichten gefunden. Es liegen keine Eingangsdaten vor, um eine Zusammenfassung zu erstellen.',
        model,
        action,
        timestamp: new Date().toISOString(),
        debug: { firecrawlUsed: useFirecrawl, query, targets, scrapedCount: 0 }
      });
    }

    let groqMessages = [];

    if (scrapedBlocks.length > 0) {
      // News‑Summary mit konkatenierten Quellen als Benutzer‑Nachricht
      const joined = scrapedBlocks.join('\n\n---\n\n');
      groqMessages = [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: `Quelleninhalte (Auszug):\n\n${joined}` }
      ];
    } else {
      // Chat‑Pfad (falls z. B. action==='chat' oder nur messages gesendet wurden)
      groqMessages = messages;
    }

    // --- Groq API Call ---
    const gr = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
      },
      body: JSON.stringify({ model, temperature, top_p, max_tokens, stream: false, messages: groqMessages })
    });

    if (!gr.ok) {
      const errText = await gr.text();
      return res.status(500).json({ error: 'Groq request failed', status: gr.status, details: errText });
    }

    const groqData = await gr.json();
    const content = groqData?.choices?.[0]?.message?.content?.trim?.() || '';

    // Begrenze (zusätzlich zur Prompt) client‑seitig oft noch einmal auf 3 Sätze; hier serverseitig weiche Begrenzung
    const limited = (() => {
      const sentences = (content || '').match(/[^.!?\n]+[.!?]/g) || [content];
      return sentences.slice(0, 3).join(' ').trim();
    })();

    return res.status(200).json({
      content: limited || content || 'Keine Antwort erhalten',
      usage: groqData.usage,
      model: groqData.model || model,
      action,
      timestamp: new Date().toISOString(),
      debug: { firecrawlUsed: useFirecrawl, query, targets, scrapedCount: scrapedBlocks.length }
    });
  } catch (err) {
    console.error('API /api/groq error:', err);
    return res.status(500).json({ error: 'Internal Server Error', details: String(err && err.message || err) });
  }
}
