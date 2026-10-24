// Execute on a trusted backend or Edge Function, NEVER in a public React bundle.
const response = await fetch(`${process.env.AI_GATEWAY_URL}/v1/chat`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.AI_GATEWAY_CLIENT_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    route: 'fast',
    messages: [{ role: 'user', content: 'Corrija a frase: I has a cat' }],
    max_tokens: 150,
  }),
});
if (!response.ok) throw new Error(`Gateway HTTP ${response.status}`);
const result = await response.json();
console.log(result.content, result.provider);
