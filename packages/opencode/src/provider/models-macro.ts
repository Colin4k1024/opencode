export async function data() {
  const path = Bun.env.MODELS_DEV_API_JSON
  if (path) {
    const file = Bun.file(path)
    if (await file.exists()) {
      return await file.text()
    }
  }
  // Try to fetch from network, but don't fail if network is unavailable (e.g., during build)
  try {
    const response = await fetch("https://models.dev/api.json", {
      signal: AbortSignal.timeout(5 * 1000), // 5 second timeout
    })
    if (response.ok) {
      return await response.text()
    }
  } catch (e) {
    // Network error is acceptable during build time
    // Return empty JSON object as fallback
    return "{}"
  }
  // If response was not ok, return empty object
  return "{}"
}
