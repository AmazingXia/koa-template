import axios from "axios";
import { parseCurlCommand } from '../../src/lib/curlconverter.js';

/**
 * 将 parseCurlCommand 返回的 request 对象转为 axios 配置
 */
function requestToAxiosConfig(request) {
  const config = {
    url: request.url,
    method: request.method || 'get',
    headers: request.headers ? { ...request.headers } : {},
    validateStatus: null, // 不按状态码抛错，由业务决定
  };
  if (request.cookieString) {
    config.headers.Cookie = request.cookieString;
  }
  if (request.data !== undefined) {
    config.data = request.data;
  }
  if (request.query && Object.keys(request.query).length > 0) {
    config.params = request.query;
  }
  if (request.auth) {
    const [username, password] = String(request.auth).split(':');
    config.auth = { username: username || '', password: password || '' };
  }
  return config;
}

export async function curlProxy(ctx) {
  const body = ctx.request.body || {};
  const query = ctx.query || {};
  const curl = body.curl ?? query.curl;

  let axiosConfig = null;
  try {
    const request = parseCurlCommand(curl.trim());
    axiosConfig = requestToAxiosConfig(request);

    console.log('axiosConfig===>', axiosConfig)
    const res = await axios(axiosConfig);
    const contentType = res.headers?.['content-type'];
    if (contentType) ctx.set('Content-Type', contentType);
    ctx.body = res.data;
  } catch (err) {
    ctx.status = 500;
    ctx.type = 'application/json';
    ctx.body = {
      code: 500,
      message: err.message,
      ...(axiosConfig && { axiosConfig: { url: axiosConfig.url, method: axiosConfig.method } }),
    };
  }
}
