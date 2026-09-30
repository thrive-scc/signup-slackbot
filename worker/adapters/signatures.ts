const encoder = new TextEncoder();
async function key(secret: string) {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}
export async function sign(secret: string, message: string) {
  const bytes = new Uint8Array(
    await crypto.subtle.sign(
      'HMAC',
      await key(secret),
      encoder.encode(message),
    ),
  );
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
}
export async function verify(
  secret: string,
  message: string,
  signature: string,
) {
  if (!/^[0-9a-f]{64}$/.test(signature)) return false;
  const bytes = Uint8Array.from(signature.match(/../g) ?? [], (byte) =>
    parseInt(byte, 16),
  );
  return crypto.subtle.verify(
    'HMAC',
    await key(secret),
    bytes,
    encoder.encode(message),
  );
}
export async function digest(message: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', encoder.encode(message)),
    ),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
}
