import { useState, useEffect } from "react"
import "./App.css"
import { FrontendApi, Configuration, Session } from "@ory/client-fetch"

interface AppProps {
  msg?: string
}

const KRATOS_BASE = import.meta.env.VITE_ORY_SDK_URL || "/kratos"
const HYDRA_CLIENT_ID = import.meta.env.VITE_HYDRA_CLIENT_ID
const HYDRA_REDIRECT_URI = import.meta.env.VITE_HYDRA_REDIRECT_URI
const HYDRA_AUTH_URL = import.meta.env.VITE_HYDRA_AUTH_URL
const HYDRA_USERINFO_URL = import.meta.env.VITE_HYDRA_USERINFO_URL
const GO_API_BASE = import.meta.env.VITE_GO_API_BASE

try {
  const refUrl = new URL(document.referrer)
  const refParams = new URLSearchParams(refUrl.search)
  const returnTo = refParams.get("return_to")

  if (returnTo) {
    const decodedReturnTo = decodeURIComponent(returnTo)
    localStorage.setItem("redirect_uri", decodedReturnTo)
    console.log("✅ Extracted return_to:", decodedReturnTo)
  } else {
    console.log("⚠️ No return_to found in referrer. Using default redirect.")
  }
} catch (err) {
  console.warn("Error parsing referrer:", err)
}

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
async function refreshAccessToken(refreshToken: string) {
  const data = new URLSearchParams()
  data.append("grant_type", "refresh_token")
  data.append("refresh_token", refreshToken)
  data.append("client_id", HYDRA_CLIENT_ID)

  const resp = await fetch(`${HYDRA_AUTH_URL}`, {
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

// -------------------------------------------

function App({ msg }: AppProps) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [hydraTokens] = useState<any>(null)
  const [users, setUsers] = useState<any>(null)
  const [hydraUserInfo, setHydraUserInfo] = useState<any>(null) // 🔥 Userinfo state

  const fetchKratosSession = async () => {
    try {
      const s = await ory.toSession()
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
        authUrl.searchParams.append("client_id", HYDRA_CLIENT_ID)
        authUrl.searchParams.append("response_type", "code")
        authUrl.searchParams.append("scope", "openid offline email")
        authUrl.searchParams.append("redirect_uri", HYDRA_REDIRECT_URI)
        authUrl.searchParams.append("state", state)
        authUrl.searchParams.append("nonce", nonce)
        authUrl.searchParams.append("code_challenge_method", "S256")
        authUrl.searchParams.append("code_challenge", codeChallenge)

        window.location.href = authUrl.toString()
      }

      const access_token = localStorage.getItem("access_token")
      const id_token = localStorage.getItem("id_token")
      let refresh_token = localStorage.getItem("refresh_token")

      if (access_token || id_token || refresh_token) {
        let validAccessToken = access_token

        // ✅ Step 1: Check if access token expired
        if (access_token) {
          const decoded = decodeJWT(access_token)
          const now = Math.floor(Date.now() / 1000)
          if (decoded?.exp && decoded.exp < now) {
            try {
              validAccessToken = await refreshAccessToken(refresh_token!)
              refresh_token = localStorage.getItem("refresh_token")
            } catch (err) {
              console.error("Token refresh failed:", err)
              localStorage.clear()
              window.location.href = "/kratos/self-service/login/browser"
              return
            }
          }
        }

        // ✅ Step 2: Fetch Hydra userinfo
        if (validAccessToken) {
          const resp = await fetch(HYDRA_USERINFO_URL, {
            headers: { Authorization: `Bearer ${validAccessToken}` },
          })
          if (resp.ok) {
            const data = await resp.json()
            setHydraUserInfo(data)
          } else if (resp.status === 401 && refresh_token) {
            // fallback: retry once if expired mid-request
            validAccessToken = await refreshAccessToken(refresh_token)
          }
        }

        // ✅ Step 3: Redirect with updated credentials
        // 🔸 Use dynamic redirect URI from localStorage
        const savedRedirectUri = localStorage.getItem("redirect_uri") || "https://nqd.ai/"
        window.location.href = `${savedRedirectUri}?access_token=${validAccessToken}&id_token=${id_token}&refresh_token=${refresh_token}`
        return
      }
    } catch (err) {
      console.warn("No active Kratos session:", err)
      window.location.href = "/kratos/self-service/login/browser"
      setSession(null)
    }
  }

  useEffect(() => {
    setLoading(true)
    fetchKratosSession().finally(() => setLoading(false))
  }, [])

  const handleLogout = async () => {
    localStorage.clear()
    try {
      const { logout_url } = await ory.createBrowserLogoutFlow()
      window.location.href = logout_url
    } catch (err) {
      console.error("Logout failed:", err)
    }
  }

  // ---------------- Fetch CategoryData from Node API ----------------
  const fetchUsers = async () => {
    try {
      let token = localStorage.getItem("access_token")
      const refresh_token = localStorage.getItem("refresh_token")
      if (!token && refresh_token) {
        token = await refreshAccessToken(refresh_token)
      }
      const resp = await fetch(`${GO_API_BASE}/api/categories`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (resp.status === 401 && refresh_token) {
        token = await refreshAccessToken(refresh_token)
        return fetchUsers()
      }

      if (!resp.ok) throw new Error("Failed to fetch users")
      const data = await resp.json()
      setUsers(data)
    } catch (err) {
      console.error(err)
      setUsers(null)
    }
  }

  if (loading) return <div className="login-container"><div className="login-card">Loading...</div></div>

  return (
    <div className="login-container">
      <div className="login-card">
        {/* Header */}
        <div className="header">
          <h1 className="login-title">{msg || "Dashboard"}</h1>
          <button onClick={handleLogout} className="btn-primary">Logout</button>
        </div>

        {/* Kratos Session */}
        {session?.identity && (
          <div className="info-box">
            <h2>Kratos Session Info</h2>
            <pre>{JSON.stringify(session.identity.traits || {}, null, 2)}</pre>
          </div>
        )}

        {/* Hydra Tokens */}
        {hydraTokens && (
          <div className="info-box">
            <h2>Hydra OAuth2 Tokens</h2>
            <pre>{JSON.stringify(hydraTokens, null, 2)}</pre>

            {hydraTokens.id_token && (
              <div>
                <h3>Decoded ID Token</h3>
                <pre>{JSON.stringify(decodeJWT(hydraTokens.id_token), null, 2)}</pre>
              </div>
            )}

            {hydraUserInfo && (
              <div>
                <h3>UserInfo from Hydra</h3>
                <pre>{JSON.stringify(hydraUserInfo, null, 2)}</pre>
              </div>
            )}

            <button onClick={fetchUsers} className="btn-primary">Category data from Node API</button>
          </div>
        )}

        {/* Users */}
        {users && (
          <div className="info-box">
            <h2>Category data from Node API</h2>
            <pre>{JSON.stringify(users, null, 2)}</pre>
          </div>
        )}
      </div>
    </div>
  )
}

export default App
