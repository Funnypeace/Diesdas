// /api/groq.js - Vercel API Route für GroqCloud Integration

export default async function handler(req, res) {
    // Nur POST-Requests erlauben
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // CORS Headers für Frontend-Zugriff
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    try {
        const { prompt, action } = req.body;

        // Input-Validierung
        if (!prompt || !action) {
            return res.status(400).json({ 
                error: 'Prompt und Action sind erforderlich' 
            });
        }

        // GroqCloud API Call
        const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'llama-3.1-70b-versatile', // Schnellstes Modell für Code-Tasks
                messages: [
                    {
                        role: 'system',
                        content: `Du bist ein erfahrener Software-Entwickler und Code-Experte. 
                                 Antworte präzise und professionell auf Deutsch. 
                                 Formatiere Code-Beispiele mit Markdown Code-Blöcken.
                                 Sei konstruktiv und hilfreich in deinen Erklärungen.`
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                max_tokens: 2048,
                temperature: 0.1, // Niedrige Temperatur für konsistente Code-Analyse
                top_p: 1,
                stream: false
            }),
        });

        if (!groqResponse.ok) {
            const errorData = await groqResponse.text();
            console.error('GroqCloud API Error:', errorData);
            return res.status(groqResponse.status).json({ 
                error: `GroqCloud API Fehler: ${groqResponse.status}` 
            });
        }

        const groqData = await groqResponse.json();

        // Antwort strukturieren
        const response = {
            content: groqData.choices[0]?.message?.content || 'Keine Antwort erhalten',
            usage: groqData.usage,
            model: groqData.model,
            action: action,
            timestamp: new Date().toISOString()
        };

        return res.status(200).json(response);

    } catch (error) {
        console.error('API Route Error:', error);
        return res.status(500).json({ 
            error: 'Interner Server-Fehler',
            details: error.message 
        });
    }
}

// Vercel Edge Runtime für bessere Performance (optional)
export const config = {
    runtime: 'edge',
}
