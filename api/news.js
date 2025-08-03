export default async function handler(req, res) {
  try {
    const { category } = req.query; // z. B. 'inland'
    const baseUrl = 'https://www.tagesschau.de/xml/rss-genios/';
    const rssUrl = `${baseUrl}${category || 'inland'}`;

    const response = await fetch(rssUrl);
    if (!response.ok) throw new Error('RSS-Fehler');
    const xmlText = await response.text();

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');
    res.status(200).json({ xml: xmlText }); // Sende rohen XML als JSON
  } catch (error) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(500).json({ error: 'Fehler beim Laden des RSS' });
  }
}
