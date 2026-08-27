const https = require('https');
const crypto = require('crypto');

const CLOUD = 'b2wkfr8r';
const API_KEY = '422946848896529';
const API_SECRET = 'GbxJF-HH8YZxUvOGPBW8Z_s9p_c';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    const body = [];
    for await (const chunk of req) body.push(chunk);
    const buffer = Buffer.concat(body);

    // Parse multipart form data
    const contentType = req.headers['content-type'] || '';
    const boundary = contentType.split('boundary=')[1];
    if (!boundary) { res.status(400).json({ error: 'No boundary' }); return; }

    // Extract file from multipart
    const boundaryBuffer = Buffer.from('--' + boundary);
    const parts = splitBuffer(buffer, boundaryBuffer);
    
    let fileBuffer = null;
    let fileName = 'file';
    let fileType = 'application/octet-stream';

    for (const part of parts) {
      const headerEnd = part.indexOf('\r\n\r\n');
      if (headerEnd === -1) continue;
      const headers = part.slice(0, headerEnd).toString();
      const content = part.slice(headerEnd + 4, part.length - 2);
      
      if (headers.includes('filename=')) {
        const nameMatch = headers.match(/filename="([^"]+)"/);
        if (nameMatch) fileName = nameMatch[1];
        const typeMatch = headers.match(/Content-Type: ([^\r\n]+)/);
        if (typeMatch) fileType = typeMatch[1].trim();
        fileBuffer = content;
      }
    }

    if (!fileBuffer) { res.status(400).json({ error: 'No file found' }); return; }

    // Sign the upload
    const timestamp = Math.round(Date.now() / 1000);
    // Use 'auto' for everything - Cloudinary handles PDFs and images
    const resourceType = 'auto';
    
    // access_mode=public must be included in signature (alphabetical order)
    const paramsToSign = `access_mode=public&timestamp=${timestamp}`;
    const signature = crypto.createHash('sha1')
      .update(paramsToSign + API_SECRET)
      .digest('hex');

    // Build multipart for Cloudinary
    const formData = buildMultipart({
      file: { buffer: fileBuffer, filename: fileName, contentType: fileType },
      access_mode: 'public',
      api_key: API_KEY,
      timestamp: String(timestamp),
      signature: signature,
    });

    // Upload to Cloudinary
    const cloudRes = await new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.cloudinary.com',
        path: `/v1_1/${CLOUD}/${resourceType}/upload`,
        method: 'POST',
        headers: {
          'Content-Type': formData.contentType,
          'Content-Length': formData.body.length,
        }
      };
      const r = https.request(options, (resp) => {
        let data = '';
        resp.on('data', chunk => data += chunk);
        resp.on('end', () => resolve({ status: resp.statusCode, body: data }));
      });
      r.on('error', reject);
      r.write(formData.body);
      r.end();
    });

    const cloudData = JSON.parse(cloudRes.body);
    if (cloudData.secure_url) {
      res.status(200).json({ url: cloudData.secure_url, name: fileName });
    } else {
      res.status(400).json({ error: cloudData.error?.message || 'Upload failed' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

function splitBuffer(buffer, delimiter) {
  const parts = [];
  let start = 0;
  let idx = buffer.indexOf(delimiter);
  while (idx !== -1) {
    parts.push(buffer.slice(start, idx));
    start = idx + delimiter.length;
    idx = buffer.indexOf(delimiter, start);
  }
  parts.push(buffer.slice(start));
  return parts.filter(p => p.length > 4);
}

function buildMultipart(fields) {
  const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);
  const parts = [];
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === 'object' && value.buffer) {
      parts.push(
        `--${boundary}\r\nContent-Disposition: form-data; name="${key}"; filename="${value.filename}"\r\nContent-Type: ${value.contentType}\r\n\r\n`
      );
      parts.push(value.buffer);
      parts.push('\r\n');
    } else {
      parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`);
    }
  }
  parts.push(`--${boundary}--\r\n`);
  
  const buffers = parts.map(p => typeof p === 'string' ? Buffer.from(p) : p);
  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    body: Buffer.concat(buffers)
  };
}
