// /api/groq.js - Vercel API Route für GroqCloud Integration mit Chat-Historie

export default async function handler(req, res) {
    console.log('=== API Route Debug Info ===');
    console.log('Method:', req.method);
    console.log('Headers:', req.headers);
    console.log('Body:', req.body);
    console.log('Query:', req.query);

    // Nur POST-Requests erlauben
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // CORS Headers für Frontend-Zugriff
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle preflight OPTIONS request
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        const { messages, action } = req.body;
        console.log('Extracted from body:');
        console.log('- messages:', messages ? `Array mit ${messages.length} Einträgen` : 'MISSING');
        console.log('- action:', action || 'MISSING');

        // Input-Validierung
        if (!messages || !Array.isArray(messages) || messages.length === 0 || !action) {
            console.log('Validation failed - missing messages or action');
            return res.status(400).json({
                error: 'Messages-Array und Action sind erforderlich',
                received: { messages: !!messages, action: !!action }
            });
        }

        // API Key prüfen
        if (!process.env.GROQ_API_KEY) {
            console.error('GROQ_API_KEY not found in environment variables');
            return res.status(500).json({
                error: 'API-Schlüssel nicht konfiguriert. Bitte GROQ_API_KEY in Vercel Environment Variables setzen.'
            });
        }

        // API Key Format prüfen
        const apiKey = process.env.GROQ_API_KEY;
        console.log('API Key length:', apiKey.length);
        console.log('API Key starts with gsk_:', apiKey.startsWith('gsk_'));

        if (!apiKey.startsWith('gsk_')) {
            return res.status(500).json({
                error: 'Ungültiges API-Schlüssel Format. Muss mit gsk_ beginnen.'
            });
        }

        console.log('Making request to GroqCloud...');
        console.log('API Key present:', !!apiKey);
        console.log('Model:', 'llama-3.3-70b-versatile');

        // System-Prompt vorne hinzufügen (nur einmal, falls nicht schon vorhanden)
        const fullMessages = [
            {
                role: 'system',
                content: `Du bist ein kreativer Content-Generator und hilfreicher Assistent. Antworte präzise und professionell auf Deutsch. Formatiere Code-Beispiele mit Markdown Code-Blöcken. Sei konstruktiv und hilfreich in deinen Erklärungen. Berücksichtige die gesamte Konversation.`
            },
            ...messages  // User- und Assistant-Messages aus Historie
        ];

        const requestBody = {
            model: 'llama-3.3-70b-versatile',
            messages: fullMessages,
            max_tokens: 2048,
            temperature: 0.7,
            top_p: 1,
            stream: false
        };

        console.log('Request body structure:', {
            model: requestBody.model,
            messageCount: requestBody.messages.length,
            maxTokens: requestBody.max_tokens
        });

        // GroqCloud API Call
        const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
        });

        if (!groqResponse.ok) {
            const errorData = await groqResponse.text();
            console.error('GroqCloud API Error:', groqResponse.status, errorData);
            return res.status(groqResponse.status).json({
                error: `GroqCloud API Fehler: ${groqResponse.status}`,
                details: errorData
            });
        }

        console.log('GroqCloud response received successfully');
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
// export const config = {
//     runtime: 'edge',
// };
