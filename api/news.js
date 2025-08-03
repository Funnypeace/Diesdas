export default async function handler(req, res) {
  // CORS Headers setzen
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // OPTIONS Request für CORS Preflight
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Nur GET Requests erlauben
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { category } = req.query;
    
    // Validiere Category Parameter
    const validCategories = ['pol', 'wirtschaft', 'ausland', 'wissen', 'sport', 'kultur'];
    const userCategory = validCategories.includes(category) ? category : 'pol';
    
    // Korrigiertes Mapping für Kategorien zu gültigen DW-Suffixen
    const categoryMap = {
      'pol': 'ger',         // Politik/Deutschland
      'wirtschaft': 'bus',  // Wirtschaft
      'ausland': 'world',   // Ausland/Welt
      'wissen': 'sci',      // Wissenschaft
      'sport': 'spo',       // Sport
      'kultur': 'cul'       // Kultur
    };
    
    // Mappe und fallback auf 'top' (Top Stories)
    const selectedCategory = categoryMap[userCategory] || 'top';

    const baseUrl = 'https://rss.dw.com/xml/rss-de-';
    const rssUrl = `${baseUrl}${selectedCategory}`;

    console.log(`Fetching RSS from: ${rssUrl}`);

    const response = await fetch(rssUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml',
        'Cache-Control': 'no-cache'
      },
      timeout: 10000 // 10 Sekunden Timeout
    });

    if (!response.ok) {
      throw new Error(`RSS-Fehler: Status ${response.status} - ${response.statusText}`);
    }

    const xmlText = await response.text();
    
    // Validiere XML Content
    if (!xmlText || xmlText.length < 100) {
      throw new Error('Ungültige oder leere RSS-Antwort');
    }

    // Prüfe ob es sich um valides XML handelt
    if (!xmlText.includes('<?xml') && !xmlText.includes('<rss')) {
      throw new Error('Antwort ist kein gültiges RSS/XML Format');
    }

    console.log(`RSS erfolgreich geladen: ${xmlText.length} Zeichen`);

    res.setHeader('Content-Type', 'application/json');
    res.status(200).json({ 
      success: true,
      xml: xmlText,
      category: selectedCategory,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('RSS API Fehler:', error.message);
    
    res.setHeader('Content-Type', 'application/json');
    res.status(500).json({ 
      success: false,
      error: `Fehler beim Laden des RSS: ${error.message}`,
      category: req.query.category || 'pol',
      timestamp: new Date().toISOString()
    });
  }
}
