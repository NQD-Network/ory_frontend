import { useLocation } from "react-router-dom"
import { useState, useEffect } from "react"
import { FrontendApi, Configuration, Session } from "@ory/client-fetch"
import { TENANTS } from "./config/tenants.config"

const HYDRA_ADMIN_URL = import.meta.env.VITE_HYDRA_ADMIN_URL || "https://admin.hydra.api.nqd.ai/admin"
const KRATOS_BASE = import.meta.env.VITE_ORY_SDK_URL || "/kratos"

const ory = new FrontendApi(
  new Configuration({ basePath: KRATOS_BASE, credentials: "include" })
)

// 🔥 Check if user has access to tenant
function userHasAccessToTenant(traits: any, tenantId: string): boolean {
  if (!traits?.tenants || !Array.isArray(traits.tenants)) {
    return false
  }
  return traits.tenants.some((t: any) => t.tenant_id === tenantId)
}

// 🔥 Get tenant info for user
function getUserTenantInfo(traits: any, tenantId: string) {
  if (!traits?.tenants) return null
  return traits.tenants.find((t: any) => t.tenant_id === tenantId)
}

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

  // 🔥 Fetch Kratos session
  useEffect(() => {
    const fetchKratos = async () => {
      try {
        const s = await ory.toSession()
        setKratosSession(s)
      } catch {
        window.location.href = `/login`
      }
    }
    fetchKratos()
  }, [])

  if (!challenge) return <div>Error: consent_challenge missing</div>
  if (error) return <div style={{ color: "red" }}>Error: {error}</div>
  if (!consentRequest || !kratosSession) return <div>Loading consent request...</div>

  const traits = kratosSession?.identity?.traits || {}
  const clientId = consentRequest.client?.client_id

  // 🔥 Find matching tenant config
  const tenantConfig = Object.values(TENANTS).find(t => t.hydra_client_id === clientId)

  // 🔥 Validate tenant access using tenants array
  if (tenantConfig && !userHasAccessToTenant(traits, tenantConfig.tenant_id)) {
    const userTenants = traits.tenants?.map((t: any) => t.tenant_id).join(', ') || 'none'

    const forceLogout = async () => {
      try {
        const { logout_url } = await ory.createBrowserLogoutFlow()
        window.location.href = logout_url
      } catch {
        window.location.href = `${KRATOS_BASE}/self-service/login/browser`
      }
    }

    return (
      <div className="login-container">
        <div className="login-card">
          <h1 className="login-title" style={{ color: "red" }}>🚨 Access Denied</h1>
          <div style={{
            background: '#ffe0e0',
            border: '2px solid #ff0000',
            borderRadius: '8px',
            padding: '20px',
            marginBottom: '20px'
          }}>
            <p style={{ margin: '0 0 10px 0', fontWeight: 'bold' }}>
              Tenant Access Denied
            </p>
            <p style={{ margin: '0 0 10px 0' }}>
              Your registered sites: <span style={{ color: '#d63031' }}>{userTenants}</span><br />
              Requested site: <span style={{ color: '#0984e3' }}>{tenantConfig.tenant_name}</span>
            </p>
            <p style={{ margin: 0, fontSize: '14px' }}>
              You need to register for {tenantConfig.tenant_name} to access it.
            </p>
          </div>
          <button
            onClick={forceLogout}
            className="btn-primary"
            style={{ width: '100%', marginBottom: '10px' }}
          >
            Log out
          </button>
          <button
            onClick={() => window.location.href = `/register?tenant_id=${tenantConfig.tenant_id}`}
            className="btn-secondary"
            style={{ width: '100%' }}
          >
            Register for {tenantConfig.tenant_name}
          </button>
        </div>
      </div>
    )
  }

  // Get user's role for this tenant
  const userTenantInfo = getUserTenantInfo(traits, tenantConfig?.tenant_id || '')

  const handleConsent = async (accept: boolean) => {
    setLoading(true)
    setError(null)

    try {
      const url = accept
        ? `${HYDRA_ADMIN_URL}/oauth2/auth/requests/consent/accept?consent_challenge=${challenge}`
        : `${HYDRA_ADMIN_URL}/oauth2/auth/requests/consent/reject?consent_challenge=${challenge}`

      const body = accept
        ? {
          grant_scope: consentRequest.requested_scope,
          session: {
            id_token: {
              email: traits.email,
              name: traits.name,
              role: userTenantInfo?.role || 'user',
              tenant_id: tenantConfig?.tenant_id,
              tenants: traits.tenants,
              primary_tenant: traits.primary_tenant,
            },
            access_token: {
              email: traits.email,
              role: userTenantInfo?.role || 'user',
              tenant_id: tenantConfig?.tenant_id,
              tenants: traits.tenants,
              primary_tenant: traits.primary_tenant,
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

      if (!res.ok) {
        const errData = await res.json()
        throw new Error(`Consent request failed: ${JSON.stringify(errData)}`)
      }

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
        {tenantConfig && (
          <img
            src={tenantConfig.theme.logo_url}
            alt={tenantConfig.tenant_name}
            style={{ height: 50, marginBottom: 20 }}
          />
        )}
        <h1 className="login-title">Consent Required</h1>

        <p>
          <strong>{consentRequest.client.client_name}</strong> is requesting access to your {tenantConfig?.tenant_name || ''} account:
        </p>

        <ul className="scope-list">
          {consentRequest.requested_scope.map((scope: string) => (
            <li key={scope}>{scope}</li>
          ))}
        </ul>

        <div style={{
          background: '#f0f0f0',
          padding: '10px',
          borderRadius: '5px',
          marginTop: '15px',
          fontSize: '14px'
        }}>
          <strong>Account:</strong> {traits.email}<br />
          <strong>Tenant:</strong> {tenantConfig?.tenant_name}<br />
          <strong>Your Role:</strong> {userTenantInfo?.role || 'user'}
        </div>

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