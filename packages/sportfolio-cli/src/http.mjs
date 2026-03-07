export async function requestJson({ baseUrl, path, method = "GET", token = "", body }) {
  let response;

  try {
    response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    const networkError = new Error(
      `Network error contacting ${baseUrl}${path}. Verify --base-url and that the server is reachable.`,
    );
    networkError.cause = error;
    throw networkError;
  }

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
