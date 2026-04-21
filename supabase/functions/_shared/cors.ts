const localhostOriginPattern = /^https?:\/\/localhost(:\d+)?$/i;
const loopbackOriginPattern = /^https?:\/\/127\.0\.0\.1(:\d+)?$/i;
const httpsOriginPattern = /^https:\/\/.+/i;

export function getCorsHeaders(origin?: string) {
  // Allow any localhost port in dev, any HTTPS origin in production
  let allowedOrigin = '*';
  if (origin) {
    if (localhostOriginPattern.test(origin)) {
      allowedOrigin = origin;
    } else if (loopbackOriginPattern.test(origin)) {
      allowedOrigin = origin;
    } else if (httpsOriginPattern.test(origin)) {
      allowedOrigin = origin;
    }
  }

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Credentials': allowedOrigin !== '*' ? 'true' : 'false',
    'Access-Control-Allow-Headers': 'authorization,x-client-info,apikey,content-type,x-requested-with',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Max-Age': '86400',
  };
}
