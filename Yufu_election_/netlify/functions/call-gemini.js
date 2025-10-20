const rateLimit = new Map();
const RATE_LIMIT_WINDOW = 60000;
const MAX_REQUESTS_PER_WINDOW = 30;
const MAX_PAYLOAD_SIZE = 100000;

function checkRateLimit(ip) {
  const now = Date.now();
  const userRequests = rateLimit.get(ip) || [];
  const recentRequests = userRequests.filter(time => now - time < RATE_LIMIT_WINDOW);
  
  if (recentRequests.length >= MAX_REQUESTS_PER_WINDOW) {
    return false;
  }
  
  recentRequests.push(now);
  rateLimit.set(ip, recentRequests);
  return true;
}

function validateRequest(requestBody) {
  if (!requestBody || typeof requestBody !== 'object') {
    throw new Error('Invalid request body');
  }
  
  if (!requestBody.contents || !Array.isArray(requestBody.contents)) {
    throw new Error('Invalid contents format');
  }
  
  const bodySize = JSON.stringify(requestBody).length;
  if (bodySize > MAX_PAYLOAD_SIZE) {
    throw new Error('Request payload too large');
  }
  
  return true;
}

exports.handler = async (event) => {
  const clientIp = event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown';
  
  if (!checkRateLimit(clientIp)) {
    return {
      statusCode: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': '60'
      },
      body: JSON.stringify({ error: 'リクエストが多すぎます。しばらくしてから再度お試しください。' }),
    };
  }
  
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: {
        'Content-Type': 'application/json',
        'Allow': 'POST'
      },
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }
  
  let requestBody;
  try {
    requestBody = JSON.parse(event.body);
    validateRequest(requestBody);
  } catch (error) {
    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ error: '無効なリクエストです。' }),
    };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  
  if (!apiKey) {
    console.error('GEMINI_API_KEY is not configured');
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ error: 'サーバー設定エラー。管理者に連絡してください。' }),
    };
  }

  const GOOGLE_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;

  try {
    const response = await fetch(GOOGLE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody), 
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('Gemini API Error:', response.status, errorData);
      
      return {
        statusCode: response.status === 429 ? 429 : 500,
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
          error: response.status === 429 
            ? 'APIのレート制限に達しました。しばらくしてから再度お試しください。'
            : 'Gemini APIの呼び出しに失敗しました。' 
        }),
      };
    }

    const data = await response.json();

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'X-Content-Type-Options': 'nosniff'
      },
      body: JSON.stringify(data),
    };

  } catch (error) {
    console.error('Unexpected error:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ error: 'サーバーエラーが発生しました。' }),
    };
  }
};