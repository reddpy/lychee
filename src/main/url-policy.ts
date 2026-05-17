export function isAllowedExternal(url: string): boolean {
  const scheme = url.split(':')[0]?.toLowerCase();
  return scheme === 'http' || scheme === 'https' || scheme === 'mailto';
}
