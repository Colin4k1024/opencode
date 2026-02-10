declare global {
  interface Window {
    __OPENCODE__?: {
      deepLinks?: string[]
      serverPassword?: string
      updaterEnabled?: boolean
    }
  }
}

export {}
