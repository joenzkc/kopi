import PostalMime from 'postal-mime';

export interface Env {
  INGEST_URL: string;
  WEBHOOK_SECRET: string; // Set via `wrangler secret put WEBHOOK_SECRET`
  FORWARD_TO?: string;
}

async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export default {
  async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext): Promise<void> {
    const rawBuffer = await new Response(message.raw).arrayBuffer();
    const parsed = await new PostalMime().parse(rawBuffer);

    const payload = JSON.stringify({
      source: 'cloudflare-email',
      message_id: parsed.messageId || message.headers.get('message-id') || crypto.randomUUID(),
      from: parsed.from?.address || message.from,
      subject: parsed.subject || message.headers.get('subject') || '',
      text: parsed.text || '',
      html: parsed.html || undefined,
      received_at: parsed.date || new Date().toISOString(),
    });

    const signature = await hmacSha256Hex(env.WEBHOOK_SECRET, payload);

    const postPromise = fetch(env.INGEST_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': `sha256=${signature}`,
      },
      body: payload,
    }).then(async (res) => {
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.error(`Ingest failed (${res.status}): ${body}`);
      }
    });

    ctx.waitUntil(postPromise);

    if (env.FORWARD_TO) {
      await message.forward(env.FORWARD_TO);
    }
  },
};
