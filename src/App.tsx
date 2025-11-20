import { useState, useEffect } from "react"
import "./App.css"
import { FrontendApi, Configuration, Session } from "@ory/client-fetch"
import { getStoredTenant, resolveTenant, getTenantFromQuery, storeTenantInfo, type TenantConfig } from "./config/tenants.config"

interface AppProps {
  msg?: string
}

const KRATOS_BASE = import.meta.env.VITE_ORY_SDK_URL || "https://kratos.api.nqd.ai"
const HYDRA_AUTH_URL = import.meta.env.VITE_HYDRA_AUTH_URL || "https://hydra.api.nqd.ai/oauth2/auth"
const HYDRA_TOKEN_URL = import.meta.env.VITE_HYDRA_TOKEN_URL || "https://hydra.api.nqd.ai/oauth2/token"
const HYDRA_USERINFO_URL = import.meta.env.VITE_HYDRA_USERINFO_URL || "https://hydra.api.nqd.ai/userinfo"

const ory = new FrontendApi(
  new Configuration({ basePath: KRATOS_BASE, credentials: "include" })
)

// ---------------- PKCE utils ----------------
function base64urlencode(str: ArrayBuffer) {
  return btoa(String.fromCharCode.apply(null, new Uint8Array(str) as any))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

async function generatePKCE() {
  const array = new Uint8Array(64)
  crypto.getRandomValues(array)
  const codeVerifier = Array.from(array).map(b => ('00' + b.toString(16)).slice(-2)).join('')
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier))
  const codeChallenge = base64urlencode(hash)
  localStorage.setItem("pkce_code_verifier", codeVerifier)
  return { codeVerifier, codeChallenge }
}

// ---------------- Token Refresh ----------------
async function refreshAccessToken(refreshToken: string, clientId: string) {
  const data = new URLSearchParams()
  data.append("grant_type", "refresh_token")
  data.append("refresh_token", refreshToken)
  data.append("client_id", clientId)

  const resp = await fetch(HYDRA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: data.toString()
  })

  if (!resp.ok) throw new Error("Failed to refresh token")
  const json = await resp.json()
  localStorage.setItem("access_token", json.access_token)
  localStorage.setItem("refresh_token", json.refresh_token)
  localStorage.setItem("id_token", json.id_token)
  return json.access_token
}

// ---------------- JWT Decode helper ----------------
function decodeJWT(token: string) {
  try {
    const [, payload] = token.split(".")
    return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")))
  } catch {
    return null
  }
}

// 🔥 Check if user has access to requested tenant
function validateSessionTenant(session: Session | null, requestedTenantId: string): { valid: boolean, reason?: string } {
  if (!session?.identity?.traits) return { valid: false, reason: 'No session' }

  const traits = session.identity.traits
  const sessionTenantId = traits.primary_tenant
  const tenants = traits.tenants || []

  // 🔥 PRIMARY CHECK: Session tenant must match requested tenant
  if (sessionTenantId !== requestedTenantId) {
    return {
      valid: false,
      reason: `Session for ${sessionTenantId}, requesting ${requestedTenantId}`
    }
  }

  // 🔥 SECONDARY CHECK: User must have access to tenant
  const hasAccess = tenants.some((t: any) => t.tenant_id === requestedTenantId)
  if (!hasAccess) {
    return {
      valid: false,
      reason: `No access to ${requestedTenantId}`
    }
  }

  return { valid: true }
}

function App({ msg }: AppProps) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [tenant, setTenant] = useState<TenantConfig | null>(null)
  const [hydraUserInfo, setHydraUserInfo] = useState<any>(null)
  const [tenantMismatch, setTenantMismatch] = useState(false)

  // 🔥 Detect tenant on mount (prioritize query -> stored -> resolve)
  useEffect(() => {
    const queryTenant = getTenantFromQuery();
    if (queryTenant) {
      setTenant(queryTenant);
      storeTenantInfo(queryTenant);
      return;
    }

    const storedTenant = getStoredTenant();
    if (storedTenant) {
      setTenant(storedTenant);
      return;
    }

    // fallback: use resolver or hostname detection
    const resolved = resolveTenant();
    setTenant(resolved);
    storeTenantInfo(resolved);
  }, []);


  const fetchKratosSession = async () => {
    if (!tenant) return

    try {
      // 🔥 Parse return_to and store it
      const params = new URLSearchParams(window.location.search)
      const returnTo = params.get("return_to")

      if (returnTo) {
        const decodedReturnTo = decodeURIComponent(returnTo)
        localStorage.setItem("redirect_uri", decodedReturnTo)
      }

      // 🔥 CRITICAL: Check existing Kratos session
      const s = await ory.toSession()

      // 🔥 VALIDATE TENANT ACCESS
      if (!validateSessionTenant(s, tenant.tenant_id)) {
        const userTenants = s.identity?.traits?.tenants || []
        const tenantIds = userTenants.map((t: any) => t.tenant_id).join(', ')

        setTenantMismatch(true)

        // Show registration option
        if (confirm(
          `You don't have access to ${tenant.tenant_name}.\n\n` +
          `Your registered sites: ${tenantIds || 'None'}\n\n` +
          `Would you like to register for ${tenant.tenant_name}?`
        )) {
          // Redirect to registration for this tenant
          window.location.href = `/register?tenant_id=${tenant.tenant_id}&return_to=${encodeURIComponent(returnTo || tenant.post_logout_redirect_uri)}`
        } else {
          setLoading(false)
          return
        }
        return
      }

      // ✅ Session tenant matches - continue normal flow
      setSession(s)

      // ---------------- Initiate OAuth2 flow if no tokens ----------------
      if (
        s &&
        !localStorage.getItem("access_token") &&
        !window.location.pathname.includes("/callback")
      ) {

        const state = crypto.randomUUID()
        localStorage.setItem("oauth_state", state)
        const nonce = crypto.randomUUID()
        localStorage.setItem("oauth_nonce", nonce)
        const { codeChallenge } = await generatePKCE()

        const authUrl = new URL(HYDRA_AUTH_URL)
        authUrl.searchParams.append("client_id", tenant.hydra_client_id)
        authUrl.searchParams.append("response_type", "code")
        authUrl.searchParams.append("scope", "openid offline email") // ✅ Removed 'profile'
        authUrl.searchParams.append("redirect_uri", tenant.redirect_uri)
        authUrl.searchParams.append("state", state)
        authUrl.searchParams.append("nonce", nonce)
        authUrl.searchParams.append("code_challenge_method", "S256")
        authUrl.searchParams.append("code_challenge", codeChallenge)

        window.location.href = authUrl.toString()
        return
      }

      const access_token = localStorage.getItem("access_token")
      const id_token = localStorage.getItem("id_token")
      let refresh_token = localStorage.getItem("refresh_token")

      if (access_token || id_token || refresh_token) {
        let validAccessToken = access_token

        // ✅ Check if access token expired
        if (access_token) {
          const decoded = decodeJWT(access_token)
          const now = Math.floor(Date.now() / 1000)
          if (decoded?.exp && decoded.exp < now) {
            try {
              validAccessToken = await refreshAccessToken(refresh_token!, tenant.hydra_client_id)
              refresh_token = localStorage.getItem("refresh_token")
            } catch (err) {
              localStorage.clear()
              // ✅ FIX: Use relative URL for login redirect
              window.location.href = `/login?tenant_id=${tenant.tenant_id}`
              return
            }
          }
        }

        // ✅ Fetch Hydra userinfo
        if (validAccessToken) {
          const resp = await fetch(HYDRA_USERINFO_URL, {
            headers: { Authorization: `Bearer ${validAccessToken}` },
          })
          if (resp.ok) {
            const data = await resp.json()
            setHydraUserInfo(data)
          }
        }

        // ✅ Redirect with updated credentials
        const savedRedirectUri = localStorage.getItem("redirect_uri") || tenant.post_logout_redirect_uri

        // Clean up before redirect
        localStorage.removeItem("redirect_uri")

        window.location.href = `${savedRedirectUri}/profile?access_token=${validAccessToken}&id_token=${id_token}&refresh_token=${refresh_token}`
        return
      }
    } catch (err) {
      if (tenant) {
        // No session exists - redirect to login
        const returnTo = localStorage.getItem("redirect_uri") || tenant.post_logout_redirect_uri

        // ✅ FIX: Use relative URL, not concatenated URL
        const loginUrl = `/login?tenant_id=${tenant.tenant_id}&return_to=${encodeURIComponent(returnTo)}`

        window.location.href = loginUrl
      }
      setSession(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!tenant) return

    setLoading(true)
    fetchKratosSession()
  }, [tenant])

  const handleLogout = async () => {
    localStorage.clear()
    try {
      const { logout_url } = await ory.createBrowserLogoutFlow()
      window.location.href = logout_url
    } catch  {
      window.location.href = `/login?tenant_id=${tenant?.tenant_id}`
    }
  }

  if (tenantMismatch) {
    return (
      <div className="login-container">
        <div className="login-card">
          <h1 className="login-title" style={{ color: "orange" }}>⚠️ Session Conflict</h1>
          <p>You're logged into a different site. Please log out to continue.</p>
        </div>
      </div>
    )
  }

  if (loading || !tenant) {
    return (
      <div className="login-container">
        <div className="login-card">Loading...</div>
      </div>
    )
  }

  return (
    <div className="login-container" style={{
      '--primary-color': tenant.theme.primary_color
    } as React.CSSProperties}>
      <div className="login-card">
        {/* Header */}
        <div className="header">
          <img src={tenant.theme.logo_url} alt={tenant.tenant_name} style={{ height: 40 }} />
          <h1 className="login-title">{msg || tenant.tenant_name}</h1>
          <button onClick={handleLogout} className="btn-primary">Logout</button>
        </div>

        {/* Kratos Session */}
        {session?.identity && (
          <div className="info-box">
            <h2>Welcome!</h2>
            <pre>{JSON.stringify(session.identity.traits || {}, null, 2)}</pre>
            <p>Tenant: <strong>{tenant.tenant_name}</strong></p>
          </div>
        )}

        {/* Hydra UserInfo */}
        {hydraUserInfo && (
          <div className="info-box">
            <h3>User Information</h3>
            <pre>{JSON.stringify(hydraUserInfo, null, 2)}</pre>
          </div>
        )}
      </div>
    </div>
  )
}

export default App