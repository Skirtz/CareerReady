/**
 * CareerReady — Cloudflare Worker Proxy
 *
 * This sits between your users and Anthropic's API.
 * Your API key never leaves this worker. Users hit this URL instead.
 *
 * ── SETUP (5 minutes) ──
 * 1. Go to https://dash.cloudflare.com → Workers & Pages → Create Worker
 * 2. Paste this entire file into the editor
 * 3. Click "Settings" → "Variables" → "Add variable"
 *    Name: ANTHROPIC_API_KEY
 *    Value: your sk-ant-... key
 *    Toggle "Encrypt" ON
 * 4. Click Deploy
 * 5. Copy your worker URL (e.g. https://careerready.yourname.workers.dev)
 * 6. Paste it into CareerReady_proxy.html where it says YOUR_WORKER_URL_HERE
 * Done. Users can now use CareerReady without entering any API key.
 *
 * ── FREE TIER ──
 * Cloudflare Workers free tier = 100,000 requests/day
 * Each CareerReady session uses roughly 6-12 API calls
 * So free tier supports roughly 8,000-16,000 user sessions per day
 *
 * ── RATE LIMITING (optional but recommended) ──
 * Uncomment the rate limiting section below to prevent abuse.
 * Free tier KV storage required for rate limiting.
 */

export default {
  async fetch(request, env) {

    // ── CORS — allow requests from your domain only ──
    // Change this to your actual domain when you deploy:
    const ALLOWED_ORIGINS = [
      'http://localhost',
      'http://127.0.0.1',
      'null', // for local file:// access during testing
      // Add your domain here, e.g.:
      // 'https://careerready.ca',
      // 'https://www.careerready.ca',
    ];

    const origin = request.headers.get('Origin') || '';
    const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*', // Tighten to allowOrigin after testing
          'Access-Control-Allow-Methods': 'POST',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
        }
      });
    }

    // Only accept POST
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    // ── OPTIONAL RATE LIMITING ──
    // Uncomment to limit each IP to 50 requests per hour
    // Requires: Settings → KV Namespaces → Create namespace "RATE_LIMIT"
    // Then bind it: Settings → Variables → KV Namespace Bindings → RATE_LIMIT
    /*
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const rateLimitKey = `rate:${ip}`;
    const current = parseInt(await env.RATE_LIMIT.get(rateLimitKey) || '0');
    if (current >= 50) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded. Try again in an hour.' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }
    await env.RATE_LIMIT.put(rateLimitKey, String(current + 1), { expirationTtl: 3600 });
    */

    try {
      // Parse the request body from CareerReady
      const body = await request.json();

      // Forward to Anthropic with your secret key
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,  // Your key, stored securely as env var
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      // Return Anthropic's response to the user
      return new Response(JSON.stringify(data), {
        status: response.status,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*', // Tighten to allowOrigin after testing
        }
      });

    } catch (err) {
      return new Response(
        JSON.stringify({ error: { message: 'Proxy error: ' + err.message } }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        }
      );
    }
  }
};
