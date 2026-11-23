export const apiPort = 3001;

export function isLoopbackUrl(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const { hostname, protocol } = new URL(value);
  return (
    (protocol === 'http:' || protocol === 'https:') &&
    ['127.0.0.1', 'localhost', '[::1]'].includes(hostname)
  );
}
