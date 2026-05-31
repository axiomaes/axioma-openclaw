export async function groqChat(systemPrompt, userPrompt) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.warn('[groq] Missing GROQ_API_KEY');
    return null;
  }

  const payload = {
    model: 'llama-3.1-8b-instant',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ]
  };

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Groq error: ${response.status} - ${err}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}
