const DEFAULT_BASE_URL = 'https://icard.njfu.edu.cn';

export class CasError extends Error {
  constructor(message, response, status) {
    super(message);
    this.name = 'CasError';
    this.response = response;
    this.status = status;
  }
}

export function normalizeToken(token) {
  if (!token) return '';
  return /^bearer\s+/i.test(token) ? token : `bearer ${token}`;
}

export function createCasClient(options = {}) {
  const baseUrl = (options.baseUrl || process.env.CAS_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
  const token = normalizeToken(options.token || process.env.SYNJONES_AUTH || process.env.CAS_TOKEN);
  const retryAttempts = options.retryAttempts ?? 3;
  const retryDelayMs = options.retryDelayMs ?? 800;

  async function request(path, { method = 'GET', params, body, form = false } = {}) {
    const url = new URL(path, baseUrl);
    const mergedParams = { ...(params || {}), synAccessSource: options.source || 'pc' };
    for (const [key, value] of Object.entries(mergedParams)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
    }

    const headers = { synAccessSource: options.source || 'pc' };
    if (token) headers['synjones-auth'] = token;

    let payload;
    if (body) {
      if (form) {
        const formBody = new URLSearchParams();
        for (const [key, value] of Object.entries({ ...body, synAccessSource: options.source || 'pc' })) {
          if (value !== undefined && value !== null) formBody.set(key, String(value));
        }
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
        payload = formBody;
      } else {
        headers['Content-Type'] = 'application/json';
        payload = JSON.stringify({ ...body, synAccessSource: options.source || 'pc' });
      }
    }

    for (let attempt = 1; attempt <= retryAttempts; attempt += 1) {
      let response;
      try {
        response = await fetch(url, { method, headers, body: payload });
      } catch (error) {
        if (attempt < retryAttempts) {
          await sleep(retryDelayMs * attempt);
          continue;
        }
        throw new Error(`CAS network request failed: ${method} ${url.pathname} (${describeNetworkError(error)})`, { cause: error });
      }
      const text = await response.text();
      const data = parseResponse(text);
      if (response.ok) return data;
      if (isTransientStatus(response.status) && attempt < retryAttempts) {
        await sleep(retryDelayMs * attempt);
        continue;
      }
      throw new CasError(`CAS request failed: ${response.status} ${response.statusText}`, data, response.status);
    }
  }

  return {
    baseUrl,
    request,
    getSingleFeeitem: feeitemid => request('/charge/feeitem/singleFeeitem', { params: { feeitemid } }),
    getThirdData: data => request('/charge/feeitem/getThirdData', { method: 'POST', body: data, form: true }),
    getElectricBillRows: params => request('/charge/turnover/app_account', { params }),
    getElectricBillTotal: params => request('/charge/turnover/app_totalAccount', { params }),
    getCardBillRows: params => request('/berserker-search/search/personal/turnover', { params }),
    getCardBillCount: params => request('/berserker-search/statistics/turnover/count', { params })
  };
}

function isTransientStatus(status) {
  return [408, 429, 500, 502, 503, 504].includes(status);
}

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function parseResponse(text) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function describeNetworkError(error) {
  const cause = error?.cause || error;
  const details = [
    cause?.code,
    cause?.errno,
    cause?.syscall,
    cause?.hostname,
    cause?.message
  ].filter(Boolean);
  return details.length ? details.join(' ') : error?.message || 'unknown network error';
}

export function assertCasOk(data, context) {
  if (data && typeof data === 'object' && 'code' in data && Number(data.code) !== 200) {
    throw new CasError(`${context} failed: ${data.msg || data.message || data.code}`, data);
  }
  return data;
}
