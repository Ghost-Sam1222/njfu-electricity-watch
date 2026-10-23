export async function sendBarkRequest(url, fetchImpl = fetch) {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`Bark HTTP request failed: ${response.status || 'unknown'}`);

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error('Bark returned invalid JSON');
  }
  if (Number(payload?.code) !== 200) throw new Error('Bark business response failed');
  return true;
}
