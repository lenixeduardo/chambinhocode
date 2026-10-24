// supabase/functions/ai-chat/index.ts
// Secrets: SUPABASE_URL, SUPABASE_ANON_KEY, AI_GATEWAY_URL, AI_GATEWAY_CLIENT_KEY
// Deploy with JWT verification enabled; gateway client key remains server-side.
import { createClient } from 'npm:@supabase/supabase-js@2';

Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const auth = request.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return new Response('Unauthorized', { status: 401 });
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return new Response('Unauthorized', { status: 401 });
  let payload: unknown;
  try { payload = await request.json(); }
  catch { return new Response('Invalid JSON', { status: 400 }); }
  const res = await fetch(`${Deno.env.get('AI_GATEWAY_URL')}/v1/chat`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${Deno.env.get('AI_GATEWAY_CLIENT_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(40000),
  });
  return new Response(await res.text(), { status: res.status, headers: { 'Content-Type': 'application/json' } });
});
