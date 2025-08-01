export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // Einfachster möglicher Test
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'llama3-8b-8192', // Einfacheres Modell
                messages: [{ role: 'user', content: 'Hallo' }],
                max_tokens: 100
            }),
        });

        const data = await response.json();
        
        return res.status(200).json({
            success: response.ok,
            status: response.status,
            data: data
        });

    } catch (error) {
        return res.status(500).json({
            error: error.message,
            stack: error.stack
        });
    }
}
