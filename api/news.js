export default async function handler(req, res) {
  try {
    const { category } = req.query; // z. B. '100' für inland
    const baseUrl = 'https://www.tagesschau.de/xml/rss-genios/';
    const rssUrl = `${baseUrl}${category || '100'}`; // Default: Inland

    const response = await fetch(rssUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    if (!response.ok) throw new Error(`RSS-Fehler: Status ${response.status}`);
    const xmlText = await response.text();

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');
    res.status(200).json({ xml: xmlText });
  } catch (error) {
    console.error('Function Error:', error.message); // Log für Vercel
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(500).json({ error: 'Fehler beim Laden des RSS: ' + error.message });
  }
}
