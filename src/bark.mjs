import { PublicError } from './publicError.mjs';

export async function sendBarkRequest(url, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl(url);
  } catch {
    throw new PublicError('Bark network request failed');
  }
  if (!response.ok) throw new PublicError(`Bark HTTP request failed: ${Number(response.status) || 'unknown'}`);

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new PublicError('Bark returned invalid JSON');
  }
  if (Number(payload?.code) !== 200) throw new PublicError('Bark business response failed');
  return true;
}
