// src/hooks/useTenantSessionGuard.ts
// 🔥 This hook ensures that the user's session always matches the current tenant

import { useEffect, useState } from "react"
import { FrontendApi, Configuration, Session } from "@ory/client-fetch"

const KRATOS_BASE = import.meta.env.VITE_ORY_SDK_URL || "/kratos"

const ory = new FrontendApi(
  new Configuration({ basePath: KRATOS_BASE, credentials: "include" })
)

interface TenantSessionState {
  isValid: boolean
  session: Session | null
  sessionTenantId: string | null
  mismatchDetected: boolean
  loading: boolean
}

export function useTenantSessionGuard(requestedTenantId: string): TenantSessionState {
  const [state, setState] = useState<TenantSessionState>({
    isValid: false,
    session: null,
    sessionTenantId: null,
    mismatchDetected: false,
    loading: true,
  })

  useEffect(() => {
    async function validateSession() {
      try {
        // Get current Kratos session
        const session = await ory.toSession()
        const sessionTenantId = session.identity?.traits?.tenant_id

        // 🔥 Check localStorage for last known tenant
        const lastTenantId = localStorage.getItem("last_tenant_id")
        const lastSessionTime = localStorage.getItem("last_session_time")
        const now = Date.now()

        // If tenant changed within 5 minutes, it's suspicious
        if (
          lastTenantId &&
          lastTenantId !== requestedTenantId &&
          lastSessionTime &&
          now - parseInt(lastSessionTime) < 5 * 60 * 1000
        ) {
          console.warn(`
            🚨 RAPID TENANT SWITCH DETECTED
            Previous tenant: ${lastTenantId}
            New tenant: ${requestedTenantId}
            Time since last switch: ${Math.floor((now - parseInt(lastSessionTime)) / 1000)}s
          `)
        }

        // 🔥 Validate tenant match
        if (sessionTenantId !== requestedTenantId) {

          setState({
            isValid: false,
            session,
            sessionTenantId,
            mismatchDetected: true,
            loading: false,
          })
          return
        }

        // ✅ Session is valid
        localStorage.setItem("last_tenant_id", requestedTenantId)
        localStorage.setItem("last_session_time", now.toString())

        setState({
          isValid: true,
          session,
          sessionTenantId,
          mismatchDetected: false,
          loading: false,
        })
      } catch (err) {
        // No session exists - this is fine
        setState({
          isValid: false,
          session: null,
          sessionTenantId: null,
          mismatchDetected: false,
          loading: false,
        })
      }
    }

    validateSession()
  }, [requestedTenantId])

  return state
}

// 🔥 Helper to force clean logout
export async function forceCleanLogout(): Promise<void> {
  // Clear all local storage
  localStorage.clear()
  sessionStorage.clear()

  try {
    // Clear Kratos session
    const { logout_url } = await ory.createBrowserLogoutFlow()
    window.location.href = logout_url
  } catch (err) {
    // Fallback: redirect to login
    window.location.href = `${KRATOS_BASE}/self-service/login/browser`
  }
}

// 🔥 Detect potential session hijacking
export function detectSessionAnomaly(): {
  suspicious: boolean
  reasons: string[]
} {
  const reasons: string[] = []
  
  // Check for rapid tenant switching
  const lastTenantId = localStorage.getItem("last_tenant_id")
  const lastSessionTime = localStorage.getItem("last_session_time")
  const currentTenantId = localStorage.getItem("tenant_id")
  
  if (
    lastTenantId &&
    currentTenantId &&
    lastTenantId !== currentTenantId &&
    lastSessionTime
  ) {
    const timeSinceSwitch = Date.now() - parseInt(lastSessionTime)
    if (timeSinceSwitch < 30 * 1000) {
      reasons.push(`Rapid tenant switch (${Math.floor(timeSinceSwitch / 1000)}s)`)
    }
  }

  // Check for multiple tabs with different tenants
  const broadcastChannel = new BroadcastChannel("tenant_check")
  broadcastChannel.postMessage({ tenant: currentTenantId, timestamp: Date.now() })

  return {
    suspicious: reasons.length > 0,
    reasons,
  }
}