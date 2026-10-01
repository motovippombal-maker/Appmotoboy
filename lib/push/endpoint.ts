export function isPublicPushEndpoint(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  return url.protocol === "https:" && !url.username && !url.password && !url.hash &&
    !/^(?:\d+|\d+(?:\.\d+){3}|\[.*\])$/.test(url.hostname) &&
    !/(?:^|\.)(?:localhost|local|internal)$/.test(url.hostname);
}
