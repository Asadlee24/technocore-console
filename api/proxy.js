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
    let targetPath = '';

    // Extract target path from query or URL
    if (req.query && req.query.path) {
      targetPath = Array.isArray(req.query.path) ? req.query.path.join('/') : req.query.path;
    } else {
      // Fallback: extract path from req.url
      const urlObj = new URL(req.url, 'http://localhost');
      const pathname = urlObj.pathname.replace(/^\/api\/proxy\/?/, '');
      targetPath = pathname;
    }

    // Clean leading slash
    if (targetPath.startsWith('/')) {
      targetPath = targetPath.slice(1);
    }

    const targetUrl = `https://technocore.chat/${targetPath}`;

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
