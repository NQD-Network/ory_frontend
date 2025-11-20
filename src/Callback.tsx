import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { getStoredTenant } from "./config/tenants.config"

const HYDRA_PUBLIC_URL = import.meta.env.VITE_HYDRA_PUBLIC_URL || "https://hydra.api.nqd.ai"

export default function Callback() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    const url = new URL(window.location.href)
    const code = url.searchParams.get("code")
    const state = url.searchParams.get("state")
    const savedState = localStorage.getItem("oauth_state")

    if (!code) {
      setError("No authorization code found")
      setLoading(false)
      return
    }

    if (!state || state !== savedState) {
      setError("State mismatch. Possible CSRF attack.")
      setLoading(false)
      return
    }

    const exchangeCode = async () => {
      try {
        // 🔥 Get tenant config to use correct client_id
        const tenant = getStoredTenant()
        if (!tenant) {
          throw new Error("No tenant config found. Please start login flow again.")
        }

        const codeVerifier = localStorage.getItem("pkce_code_verifier")
        if (!codeVerifier) throw new Error("PKCE code verifier missing")

        const body = new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: tenant.redirect_uri, // ✅ Use tenant-specific redirect_uri
          client_id: tenant.hydra_client_id, // ✅ Use tenant-specific client_id
          code_verifier: codeVerifier,
        })

        const res = await fetch(`${HYDRA_PUBLIC_URL}/oauth2/token`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body,
          credentials: "include",
        })

        if (!res.ok) {
          const text = await res.text()
          throw new Error(`Token exchange failed: ${res.status} ${text}`)
        }

        const data = await res.json()

        // Save tokens
        localStorage.setItem("access_token", data.access_token)
        localStorage.setItem("id_token", data.id_token)
        if (data.refresh_token) localStorage.setItem("refresh_token", data.refresh_token)

        // 🔥 Validate token tenant matches
        try {
          const payload = JSON.parse(atob(data.access_token.split('.')[1]))

          if (payload.tenant_id && payload.tenant_id !== tenant.tenant_id) {
            throw new Error(
              `Token tenant mismatch! Token: ${payload.tenant_id}, Expected: ${tenant.tenant_id}`
            )
          }
        } catch {
          window.location.href = `/login?tenant_id=${tenant?.tenant_id}`
        }

        // Cleanup
        localStorage.removeItem("pkce_code_verifier")
        localStorage.removeItem("oauth_state")
        localStorage.removeItem("oauth_nonce")

        // Get saved redirect URI
        const redirectUri = localStorage.getItem("redirect_uri") || tenant.post_logout_redirect_uri
        localStorage.removeItem("redirect_uri")

        // Redirect back to the app with tokens
        window.location.href = `${redirectUri}/profile?access_token=${data.access_token}&id_token=${data.id_token}&refresh_token=${data.refresh_token || ''}`
      } catch (err: any) {
        setError(err.message)
        setLoading(false)
      }
    }

    exchangeCode()
  }, [navigate])

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        fontFamily: 'system-ui'
      }}>
        <div style={{
          width: '40px',
          height: '40px',
          border: '4px solid #f3f3f3',
          borderTop: '4px solid #3498db',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite'
        }}></div>
        <p style={{ marginTop: '20px', color: '#666' }}>
          Exchanging authorization code for tokens...
        </p>
        <style>{`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        fontFamily: 'system-ui',
        padding: '20px'
      }}>
        <div style={{
          maxWidth: '500px',
          background: '#fff',
          padding: '30px',
          borderRadius: '12px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
          textAlign: 'center'
        }}>
          <div style={{ fontSize: '48px', marginBottom: '20px' }}>❌</div>
          <h2 style={{ color: '#d63031', marginBottom: '16px' }}>
            Authentication Error
          </h2>
          <p style={{ color: '#666', marginBottom: '24px' }}>
            {error}
          </p>
          <button
            onClick={() => {
              localStorage.clear()
              window.location.href = '/login'
            }}
            style={{
              padding: '12px 24px',
              background: '#3498db',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              fontSize: '16px',
              cursor: 'pointer',
              fontWeight: '600'
            }}
          >
            Try Again
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      fontFamily: 'system-ui'
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '48px', marginBottom: '20px' }}>✅</div>
        <p style={{ color: '#27ae60', fontSize: '18px', fontWeight: '600' }}>
          Login successful! Redirecting...
        </p>
      </div>
    </div>
  )
}