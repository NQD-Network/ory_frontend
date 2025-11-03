import { useLocation } from "react-router-dom"
import { useState, useEffect } from "react"
import { FrontendApi, Configuration, Session } from "@ory/client-fetch"

const HYDRA_ADMIN_URL = "/hydra-admin/admin"
const KRATOS_BASE = import.meta.env.VITE_ORY_SDK_URL || "/kratos"

const ory = new FrontendApi(
  new Configuration({ basePath: KRATOS_BASE, credentials: "include" })
)

export default function Consent() {
  const location = useLocation()
  const params = new URLSearchParams(location.search)
  const challenge = params.get("consent_challenge")

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [consentRequest, setConsentRequest] = useState<any>(null)
  const [kratosSession, setKratosSession] = useState<Session | null>(null)

  // 🔥 Fetch Hydra consent request
  useEffect(() => {
    if (!challenge) return
    const fetchConsent = async () => {
      try {
        const res = await fetch(
          `${HYDRA_ADMIN_URL}/oauth2/auth/requests/consent?consent_challenge=${challenge}`
        )
        if (!res.ok) throw new Error(`Failed to fetch consent request: ${res.statusText}`)
        const data = await res.json()
        setConsentRequest(data)
      } catch (err: any) {
        setError(err.message)
      }
    }
    fetchConsent()
  }, [challenge])

  // 🔥 Fetch Kratos session (traits = email, role, projects)
  useEffect(() => {
    const fetchKratos = async () => {
      try {
        const s = await ory.toSession()
        setKratosSession(s)
      } catch (err) {
        console.error("No Kratos session:", err)
      }
    }
    fetchKratos()
  }, [])

  if (!challenge) return <div>Error: consent_challenge missing</div>
  if (error) return <div style={{ color: "red" }}>Error: {error}</div>
  if (!consentRequest) return <div>Loading consent request...</div>

  const handleConsent = async (accept: boolean) => {
    setLoading(true)
    setError(null)

    try {
      const url = accept
        ? `${HYDRA_ADMIN_URL}/oauth2/auth/requests/consent/accept?consent_challenge=${challenge}`
        : `${HYDRA_ADMIN_URL}/oauth2/auth/requests/consent/reject?consent_challenge=${challenge}`

      const traits = kratosSession?.identity?.traits || {}
      const body = accept
        ? {
          grant_scope: consentRequest.requested_scope,
          session: {
            // 🔥 Custom claims forwarded to Hydra
            id_token: {
              email: traits.email,
              role: traits.role,
            },
            access_token: {
              projects: traits.projects || [],
              role: traits.role
            },
          },
        }
        : {
          error: "access_denied",
          error_description: "The resource owner denied the request",
        }

      const res = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      if (!res.ok) throw new Error(`Consent request failed: ${res.statusText}`)
      const data = await res.json()

      if (data.redirect_to) {
        window.location.href = data.redirect_to
      } else {
        throw new Error("No redirect_to returned from Hydra")
      }
    } catch (err: any) {
      setError(err.message)
      setLoading(false)
    }
  }

  return (
    <div className="login-container">
      <div className="login-card">
        <h1 className="login-title">Consent Required</h1>

        <p>
          The app <strong>{consentRequest.client.client_name}</strong> is requesting access to:
        </p>

        <ul className="scope-list">
          {consentRequest.requested_scope.map((scope: string) => (
            <li key={scope}>{scope}</li>
          ))}
        </ul>

        {error && <p className="error-text">⚠ {error}</p>}

        <div className="button-group">
          <button
            disabled={loading}
            onClick={() => handleConsent(true)}
            className="btn-primary"
          >
            {loading ? "Processing..." : "Allow"}
          </button>

          <button
            disabled={loading}
            onClick={() => handleConsent(false)}
            className="btn-secondary"
          >
            {loading ? "Processing..." : "Deny"}
          </button>
        </div>
      </div>
    </div>
  )
}
