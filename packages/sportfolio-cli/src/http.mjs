export async function requestJson({ baseUrl, path, method = "GET", token = "", body }) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let data = null;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
  }

  if (!response.ok) {
    const message = data?.message || data?.error || `${response.status} ${response.statusText}`;
    const error = new Error(message);
    error.statusCode = response.status;
    throw error;
  }

  return data;
}
