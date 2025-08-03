export default async function handler(req, res) {
  try {
    const { category } = req.query; // z. B. 'inland', 'wirtschaft' etc.
    const baseUrl = 'https://www.tagesschau.de/xml/rss-genios/';
    const rssUrl = `${baseUrl}${category || 'inland'}`; // Default: Politik

    const response = await fetch(rssUrl);
    if (!response.ok) throw new Error('RSS-Fehler');
    const xmlText = await response.text();

    // Parsen des XML zu JSON (mit DOMParser)
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
    const items = Array.from(xmlDoc.querySelectorAll('item')).map(item => ({
      title: item.querySelector('title')?.textContent || 'Kein Titel',
      description: item.querySelector('description')?.textContent || 'Keine Beschreibung',
      link: item.querySelector('link')?.textContent || '#',
    })).slice(0, 5); // Begrenze auf 5 Items

    res.setHeader('Access-Control-Allow-Origin', '*'); // CORS erlauben
    res.setHeader('Content-Type', 'application/json');
    res.status(200).json({ items });
  } catch (error) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(500).json({ error: 'Fehler beim Laden des RSS' });
  }
}
