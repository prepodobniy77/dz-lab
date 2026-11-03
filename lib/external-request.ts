// Public hosting has no trusted Sites identity proxy. Never forward client identity.
export function externalRequest(request: Request): Request {
  const headers = new Headers(request.headers);
  for (const name of [...headers.keys()]) {
    if (name.startsWith('oai-authenticated-user-')) headers.delete(name);
  }
  return new Request(request, { headers });
}
