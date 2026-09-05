const DEFAULT_BASE_URL = 'https://icard.njfu.edu.cn';

export class CasError extends Error {
  constructor(message, response) {
    super(message);
    this.name = 'CasError';
    this.response = response;
  }
}

export function normalizeToken(token) {
  if (!token) return '';
  return /^bearer\s+/i.test(token) ? token : `bearer ${token}`;
}

export function createCasClient(options = {}) {
  const baseUrl = (options.baseUrl || process.env.CAS_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
  const token = normalizeToken(options.token || process.env.SYNJONES_AUTH || process.env.CAS_TOKEN);

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

    const response = await fetch(url, { method, headers, body: payload });
    const text = await response.text();
    const data = parseResponse(text);
    if (!response.ok) {
      throw new CasError(`CAS request failed: ${response.status} ${response.statusText}`, data);
    }
    return data;
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

function parseResponse(text) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function assertCasOk(data, context) {
  if (data && typeof data === 'object' && 'code' in data && Number(data.code) !== 200) {
    throw new CasError(`${context} failed: ${data.msg || data.message || data.code}`, data);
  }
  return data;
}
