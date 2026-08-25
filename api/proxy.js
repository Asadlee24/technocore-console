/**
 * Vercel Serverless Proxy for Technocore Protocol
 * Secure server-to-server forwarder for technocore.chat.
 * Completely eliminates third-party CORS proxy dependencies.
 */

export default async function handler(req, res) {
  // CORS Headers for browser client
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    let targetUrl = '';

    // Primary: Read explicit ?url= parameter
    if (req.query && req.query.url) {
      targetUrl = req.query.url;
    } else if (req.query && req.query.path) {
      const rawPath = Array.isArray(req.query.path) ? req.query.path.join('/') : req.query.path;
      targetUrl = `https://technocore.chat/${rawPath.replace(/^\//, '')}`;
    } else {
      // Fallback: Parse from req.url
      const parsed = new URL(req.url, 'http://localhost');
      const paramUrl = parsed.searchParams.get('url');
      if (paramUrl) {
        targetUrl = paramUrl;
      } else {
        const subpath = parsed.pathname.replace(/^\/api\/proxy\/?/, '');
        targetUrl = `https://technocore.chat/${subpath}${parsed.search}`;
      }
    }

    // Security validation: Only allow requests to technocore.chat
    if (!targetUrl.startsWith('https://technocore.chat/') && targetUrl !== 'https://technocore.chat') {
      return res.status(400).json({ error: 'Target URL must start with https://technocore.chat/' });
    }

    const response = await fetch(targetUrl, {
      method: req.method,
      headers: {
        'User-Agent': 'TechnocoreConsole/2.0 (Self-Hosted Proxy)',
        'Accept': 'text/plain, application/json, */*'
      }
    });

    const body = await response.text();
    const contentType = response.headers.get('content-type') || 'text/plain; charset=utf-8';

    res.setHeader('Content-Type', contentType);
    return res.status(response.status).send(body);
  } catch (error) {
    return res.status(502).json({
      error: 'Proxy gateway error connecting to technocore.chat',
      details: error.message
    });
  }
}
