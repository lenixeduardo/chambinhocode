export class GatewayClient {
    key;
    url;
    constructor(baseUrl, key) {
        this.key = key;
        const url = new URL(baseUrl);
        if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname))) {
            throw new Error('Gateway remoto precisa de HTTPS; HTTP permitido apenas em localhost.');
        }
        if (url.username || url.password || url.search || url.hash)
            throw new Error('URL do gateway inválida.');
        this.url = url.toString().replace(/\/$/, '');
    }
    async chatStream(route, messages, onDelta) {
        if (!this.key || this.key.length < 24)
            throw new Error('CHAMBINHO_CLIENT_KEY inválida.');
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 120_000);
        try {
            const response = await fetch(`${this.url}/v1/chat/stream`, {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream', 'Authorization': `Bearer ${this.key}` },
                body: JSON.stringify({ route, messages, max_tokens: 3072, temperature: 0.2 }), signal: controller.signal
            });
            if (response.status === 404 || response.status === 405)
                return this.chat(route, messages);
            if (!response.ok || !response.body)
                throw new Error(`Streaming HTTP ${response.status}`);
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let content = '';
            let provider = '?';
            let model = '?';
            let done = false;
            const consume = (block) => {
                const event = block.match(/^event: (.+)$/m)?.[1];
                const raw = block.match(/^data: (.+)$/m)?.[1];
                if (!raw)
                    return;
                const data = JSON.parse(raw);
                if (event === 'meta') {
                    provider = data.provider || '?';
                    model = data.model || '?';
                }
                if (event === 'delta' && typeof data.content === 'string') {
                    content += data.content;
                    onDelta(data.content);
                }
                if (event === 'error')
                    throw new Error(data.message || 'Stream interrompido');
                if (event === 'done')
                    done = true;
            };
            while (!done) {
                const { value, done: ended } = await reader.read();
                if (ended)
                    break;
                buffer += decoder.decode(value, { stream: true }).replace(/\r/g, '');
                if (buffer.length > 1_000_000)
                    throw new Error('Buffer SSE excedido');
                let cut;
                while ((cut = buffer.indexOf('\n\n')) >= 0) {
                    const block = buffer.slice(0, cut);
                    buffer = buffer.slice(cut + 2);
                    consume(block);
                }
            }
            if (!done)
                throw new Error('Streaming encerrado sem confirmação');
            return { content, provider, model };
        }
        finally {
            clearTimeout(timeout);
        }
    }
    async chat(route, messages) {
        if (!this.key || this.key.length < 24)
            throw new Error('Defina CHAMBINHO_CLIENT_KEY com a chave do cliente CLI (mínimo 24 caracteres).');
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 65_000);
        try {
            const result = await fetch(`${this.url}/v1/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.key}` },
                body: JSON.stringify({ route, messages, max_tokens: 3072, temperature: 0.2 }),
                signal: controller.signal
            });
            if (!result.ok)
                throw new Error(`Gateway HTTP ${result.status}: ${String(await result.text()).slice(0, 250)}`);
            const body = await result.json();
            if (!body || typeof body !== 'object' || !('content' in body) || typeof body.content !== 'string') {
                throw new Error('Resposta inválida do gateway.');
            }
            const data = body;
            return { content: data.content, provider: String(data.provider || '?'), model: String(data.model || '?'), usage: data.usage };
        }
        finally {
            clearTimeout(timeout);
        }
    }
}
