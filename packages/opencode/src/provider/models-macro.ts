import { Global } from "../global"

export async function data() {
  const path = Bun.env.MODELS_DEV_API_JSON
  if (path) {
    const file = Bun.file(path)
    if (await file.exists()) {
      return await file.text()
    }
  }
  const url = Global.Path.modelsDevUrl
  try {
    const response = await fetch(`${url}/api.json`, {
      signal: AbortSignal.timeout(5 * 1000),
    })
    if (response.ok) return await response.text()
  } catch {
    return "{}"
  }
  return "{}"
}
