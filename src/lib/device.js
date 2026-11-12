function toBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function randomToken(prefix) {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `${prefix}${toBase64Url(bytes)}`;
}

export function uid() {
  return crypto.randomUUID();
}

function simpleBrowserLabel(ua = navigator.userAgent) {
  const mobile = /Mobile|Android|iPhone|iPad|iPod/i.test(ua);
  let browser = '浏览器';
  if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/Chrome\//i.test(ua) && !/Chromium/i.test(ua)) browser = 'Chrome';
  else if (/Safari\//i.test(ua) && !/Chrome/i.test(ua)) browser = 'Safari';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';
  return `${mobile ? '移动端' : '桌面端'} · ${browser}`;
}

export async function getDeviceInfo() {
  const parts = [
    navigator.userAgent,
    navigator.language,
    navigator.languages?.join(',') || '',
    Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    `${screen.width}x${screen.height}x${screen.colorDepth}`,
    String(navigator.hardwareConcurrency || ''),
    String(navigator.maxTouchPoints || ''),
    navigator.platform || ''
  ];
  let fingerprint = '';
  try {
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(parts.join('|'))
    );
    fingerprint = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 32);
  } catch {
    fingerprint = `fallback-${toBase64Url(crypto.getRandomValues(new Uint8Array(12)))}`;
  }

  return {
    fingerprint,
    label: simpleBrowserLabel(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    screen: `${screen.width}×${screen.height}`,
    language: navigator.language || ''
  };
}
