/**
 * Vercel Serverless Proxy for Technocore Protocol
 * Bypasses browser CORS restrictions by proxying requests server-side.
 */

export default async function handler(req, res) {
  // Set CORS headers so frontend can call it freely
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { path } = req.query;
    const targetPath = Array.isArray(path) ? path.join('/') : (path || '');
    
    // Construct query parameters
    const queryParams = { ...req.query };
    delete queryParams.path;
    const searchParams = new URLSearchParams(queryParams).toString();
    const targetUrl = `https://technocore.chat/${targetPath}${searchParams ? `?${searchParams}` : ''}`;

    const response = await fetch(targetUrl, {
      method: req.method,
      headers: {
        'User-Agent': 'TechnocoreConsole/1.0',
        'Accept': 'text/plain, application/json, */*'
      }
    });

    const body = await response.text();
    const contentType = response.headers.get('content-type') || 'text/plain';

    res.setHeader('Content-Type', contentType);
    return res.status(response.status).send(body);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
