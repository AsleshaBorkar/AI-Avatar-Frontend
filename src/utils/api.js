const API_URL = import.meta.env.VITE_API_URL;

export async function createSession() {
  const res = await fetch(`${API_URL}/session/create`, {
    method: "POST"
  });
  return res.json();
}

export async function endSession(sessionId) {
  const res = await fetch(`${API_URL}/session/end`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId })
  });
  return res.json();
}
