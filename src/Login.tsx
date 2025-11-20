import { useEffect, useState, useRef } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import {
  Configuration,
  FrontendApi,
  LoginFlow,
  Session,
  UiNode,
  UiNodeInputAttributes,
} from "@ory/client-fetch"
import { TENANTS, getStoredTenant, detectTenant, getTenantFromQuery, storeTenantInfo, type TenantConfig } from "./config/tenants.config"

const KRATOS_BASE = import.meta.env.VITE_ORY_SDK_URL || "/kratos"
const HYDRA_ADMIN_URL = import.meta.env.VITE_HYDRA_ADMIN_URL || "https://admin.hydra.api.nqd.ai/admin"

const ory = new FrontendApi(
  new Configuration({
    basePath: KRATOS_BASE,
    credentials: "include",
  })
)

// 🔥 Check if user has access to tenant
function userHasAccessToTenant(session: Session | null, tenantId: string): boolean {
  if (!session?.identity?.traits) return false
  const tenants = session.identity.traits.tenants || []
  return tenants.some((t: any) => t.tenant_id === tenantId)
}

// 🔥 Get user's tenant list
function getUserTenants(session: Session | null): string {
  if (!session?.identity?.traits?.tenants) return 'none'
  return session.identity.traits.tenants.map((t: any) => t.tenant_id).join(', ')
}

// 🔥 Add new tenant to user's identity
async function addTenantToUser(session: Session | null, newTenantId: string): Promise<boolean> {
  try {
    const userId = session?.identity?.id
    const currentTraits = session?.identity?.traits || {}

    const existingTenants = (currentTraits as any).tenants || []
    if (existingTenants.some((t: any) => t.tenant_id === newTenantId)) {
      return true
    }

    const newTenant = {
      role: "user",
      projects: [],
      tenant_id: newTenantId,
    }

    const updatedTraits = {
      ...currentTraits,
      tenants: [...existingTenants, newTenant],
    }

    const ADD_TENANT_API_URL = import.meta.env.VITE_ADD_TENANT_API_URL || "http://localhost:4000"
    
    const response = await fetch(`${ADD_TENANT_API_URL}/api/kratos/add-tenant`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId,
        schema_id: session?.identity?.schema_id,
        traits: updatedTraits,
        state: session?.identity?.state,
      }),
    })

    if (!response.ok) {
      return false
    }

    return true
  } catch (err) {
    return false
  }
}

export default function Login() {
  const [flow, setFlow] = useState<LoginFlow | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [tenant, setTenant] = useState<TenantConfig | null>(null)
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [sessionChecked, setSessionChecked] = useState(false)
  const [isAddingTenant, setIsAddingTenant] = useState(false)

  const logoutTriggered = useRef(false)
  const flowInitialized = useRef(false)
  const tenantResolved = useRef(false)
  const tenantAddAttempted = useRef(false)

  const location = useLocation()
  const navigate = useNavigate()
  const searchParams = new URLSearchParams(location.search)

  const flowId = searchParams.get("flow")
  const returnTo = searchParams.get("return_to") || "/"
  const loginChallenge = searchParams.get("login_challenge")

  // 🔥 STEP 1: Detect tenant on mount
  useEffect(() => {
    if (logoutTriggered.current || tenantResolved.current) return

    // 🔥 FIX: Check logout target restoration FIRST (highest priority after tenant mismatch)
    const logoutTarget = sessionStorage.getItem("logout_target_tenant")
    if (logoutTarget) {
      const targetTenantConfig = Object.values(TENANTS).find(t => t.tenant_id === logoutTarget)
      if (targetTenantConfig) {
        setTenant(targetTenantConfig)
        storeTenantInfo(targetTenantConfig)
        tenantResolved.current = true
        sessionStorage.removeItem("logout_target_tenant")
        return
      }
    }

    // Query parameter (highest priority for new flows)
    const queryTenant = getTenantFromQuery()
    if (queryTenant) {
      setTenant(queryTenant)
      storeTenantInfo(queryTenant)
      tenantResolved.current = true
      return
    }

    // Stored tenant
    const storedTenant = getStoredTenant()
    if (storedTenant) {
      const currentHost = `${window.location.hostname}:${window.location.port}`
      if (currentHost === "localhost:5173" || currentHost.includes('auth.nqd.ai')) {
        setTenant(storedTenant)
        tenantResolved.current = true
        return
      }
    }

    // Hostname detection (fallback)
    const detectedTenant = detectTenant()
    setTenant(detectedTenant)
    storeTenantInfo(detectedTenant)
    tenantResolved.current = true
  }, [])

  // 🔥 STEP 2: Fetch session and check tenant access
  useEffect(() => {
    if (logoutTriggered.current || !tenant || tenantAddAttempted.current) return

    async function fetchSession() {
      try {
        const s = await ory.toSession()

        // Check tenant access
        if (!userHasAccessToTenant(s, tenant!.tenant_id)) {

          tenantAddAttempted.current = true
          setIsAddingTenant(true)

          // Try to add tenant to user
          const success = await addTenantToUser(s, tenant!.tenant_id)

          if (success) {

            // 🔥 CRITICAL: Clear old OAuth tokens to force generation of new ones
            localStorage.removeItem("access_token")
            localStorage.removeItem("refresh_token")
            localStorage.removeItem("id_token")

            // Wait a bit for Kratos to update
            await new Promise(resolve => setTimeout(resolve, 1000))

            // Fetch updated session
            try {
              const updatedSession = await ory.toSession()

              // Verify tenant was added
              if (userHasAccessToTenant(updatedSession, tenant!.tenant_id)) {
                setSession(updatedSession)
                setSessionChecked(true)
                setIsAddingTenant(false)

                // Redirect to app (which will now generate fresh OAuth tokens)
                navigate(returnTo)
                return
              } else {
                console.error("❌ Tenant not found in updated session")
              }
            } catch (err) {
              console.error("❌ Failed to fetch updated session:", err)
            }
          } else {

            // 🔥 FIX: Store tenant in sessionStorage BEFORE clearing localStorage
            sessionStorage.setItem("logout_target_tenant", tenant!.tenant_id)

            // Fallback to logout flow
            logoutTriggered.current = true
            setIsLoggingOut(true)
            setIsAddingTenant(false)

            localStorage.clear()

            setTimeout(async () => {
              try {
                const { logout_url } = await ory.createBrowserLogoutFlow()

                const baseUrl = window.location.origin + window.location.pathname
                const finalReturnUrl = `${baseUrl}?tenant_id=${tenant?.tenant_id}&return_to=${encodeURIComponent(returnTo)}`

                window.location.href = `${logout_url}&return_to=${encodeURIComponent(finalReturnUrl)}`
              } catch (err) {
                const baseUrl = window.location.origin + window.location.pathname
                window.location.href = `${baseUrl}?tenant_id=${tenant?.tenant_id}&return_to=${encodeURIComponent(returnTo)}`
              }
            }, 100)
          }

          return
        }

        // Session is valid for this tenant
        setSession(s)
        setSessionChecked(true)
      } catch {
        // No session - this is fine
        setSession(null)
        setSessionChecked(true)
      }
    }

    fetchSession()
  }, [tenant, returnTo, navigate])

  // 🔥 STEP 3: Handle Hydra login acceptance
  useEffect(() => {
    if (logoutTriggered.current || !sessionChecked) return

    if (loginChallenge && session?.identity?.id && tenant) {
      if (!userHasAccessToTenant(session, tenant.tenant_id)) {
        return
      }

      fetch(
        `${HYDRA_ADMIN_URL}/oauth2/auth/requests/login/accept?login_challenge=${loginChallenge}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subject: session.identity.id,
            context: {
              tenant_id: tenant.tenant_id
            }
          }),
        }
      )
        .then((res) => res.json())
        .then((data) => {
          window.location.href = data.redirect_to
        })
        .catch((err) => console.error("Hydra login accept failed:", err))
    }
  }, [loginChallenge, session, tenant, sessionChecked])

  // 🔥 STEP 4: Initialize Kratos login flow
  useEffect(() => {
    if (logoutTriggered.current) {
      return
    }
    if (!tenant) {
      return
    }
    if (!sessionChecked) {
      return
    }
    if (loginChallenge) {
      return
    }
    if (flowInitialized.current) {
      return
    }

    const initFlow = async () => {
      // If already logged in with correct tenant → redirect to app
      if (session) {
        navigate("/")
        return
      }

      try {
        if (flowId) {
          const res = await ory.getLoginFlow({ id: flowId })
          setFlow(res)
          flowInitialized.current = true
        } else {
          flowInitialized.current = true

          const currentUrl = new URL(window.location.href)
          currentUrl.searchParams.set('tenant_id', tenant.tenant_id)

          const kratosLoginUrl = `${KRATOS_BASE}/self-service/login/browser?return_to=${encodeURIComponent(currentUrl.toString())}`
          window.location.href = kratosLoginUrl
        }
      } catch (err) {
        flowInitialized.current = false
      }
    }

    initFlow()
  }, [flowId, loginChallenge, session, tenant, navigate, returnTo, sessionChecked])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!flow || !tenant || logoutTriggered.current) return

    const form = new FormData(e.target as HTMLFormElement)
    const csrfNode = flow.ui.nodes.find(
      (n: UiNode) =>
        n.attributes &&
        "name" in n.attributes &&
        n.attributes.name === "csrf_token"
    ) as UiNode | undefined

    const csrfToken =
      csrfNode && "value" in csrfNode.attributes
        ? (csrfNode.attributes as UiNodeInputAttributes).value
        : undefined

    try {
      const result = await ory.updateLoginFlow({
        flow: flow.id,
        updateLoginFlowBody: {
          method: "password",
          identifier: form.get("identifier") as string,
          password: form.get("password") as string,
          csrf_token: csrfToken,
        },
      })

      // 🔥 NEW: Check tenant access and attempt to add tenant if missing
      if (!userHasAccessToTenant(result.session, tenant.tenant_id)) {
        const userTenants = getUserTenants(result.session)

        // Show info message
        alert(
          `🔄 Adding ${tenant.tenant_name} to your account...\n\n` +
          `Your current tenants: ${userTenants}\n\n` +
          `Adding access to: ${tenant.tenant_name}`
        )

        // Set loading state
        setIsAddingTenant(true)

        // Attempt to add tenant
        const success = await addTenantToUser(result.session, tenant.tenant_id)

        if (success) {
          console.log(`✅ Successfully added tenant: ${tenant.tenant_id}`)

          // Clear old OAuth tokens
          localStorage.removeItem("access_token")
          localStorage.removeItem("refresh_token")
          localStorage.removeItem("id_token")

          // Wait for Kratos to update
          await new Promise(resolve => setTimeout(resolve, 1000))

          // Verify the update
          try {
            const updatedSession = await ory.toSession()

            if (userHasAccessToTenant(updatedSession, tenant.tenant_id)) {
              setSession(updatedSession)
              setIsAddingTenant(false)

              // Success! Redirect to app
              window.location.href = returnTo
              return
            } else {
              console.error("❌ Tenant not found in updated session")
              setIsAddingTenant(false)
              alert("Failed to verify tenant access. Please try again.")
              return
            }
          } catch (err) {
            console.error("❌ Failed to fetch updated session:", err)
            setIsAddingTenant(false)
            alert("Failed to verify session. Please try again.")
            return
          }
        } else {
          // Failed to add tenant - fall back to logout flow
          console.error(`❌ Failed to add tenant: ${tenant.tenant_id}`)
          setIsAddingTenant(false)

          alert(
            `🚨 Access Denied!\n\n` +
            `Your account is registered for: ${userTenants}\n\n` +
            `You're trying to access: ${tenant.tenant_name}\n\n` +
            `Unable to add this tenant to your account. Please contact support or register a new account.`
          )

          // Store target tenant and logout
          sessionStorage.setItem("logout_target_tenant", tenant.tenant_id)
          logoutTriggered.current = true
          localStorage.clear()

          await ory.createBrowserLogoutFlow().then(({ logout_url }) => {
            const returnUrl = `/login?tenant_id=${tenant.tenant_id}&return_to=${encodeURIComponent(returnTo)}`
            window.location.href = `${logout_url}&return_to=${encodeURIComponent(returnUrl)}`
          })
          return
        }
      }

      // User has access - proceed normally
      window.location.href = returnTo
    } catch (err: any) {
      setIsAddingTenant(false)
      alert(err?.response?.data?.ui?.messages?.[0]?.text || "Login failed")
    }
  }

  // 🚀 Google OAuth with proper tenant context
  const handleGoogleLogin = async () => {
    if (!flow || !tenant) {
      return
    }

    // 🔥 Store tenant context in multiple places
    sessionStorage.setItem('oauth_tenant_id', tenant.tenant_id)
    sessionStorage.setItem('oauth_return_to', returnTo)
    localStorage.setItem('oauth_tenant_id', tenant.tenant_id)
    localStorage.setItem('oauth_return_to', returnTo)

    const csrfNode = flow.ui.nodes.find((n: any) => n.attributes?.name === 'csrf_token')
    if (!csrfNode) {
      return
    }

    try {
      const result = await ory.updateLoginFlow({
        flow: flow.id,
        updateLoginFlowBody: {
          method: 'oidc',
          provider: 'google',
          csrf_token: (csrfNode.attributes as any).value
        },
      })

      if (result && 'redirect_browser_to' in result) {
        window.location.href = (result as any).redirect_browser_to
      }
    } catch (err: any) {

      if (err.response) {
        try {
          const errorData = await err.response.json()

          if (errorData.redirect_browser_to) {
            window.location.href = errorData.redirect_browser_to
            return
          }
        } catch (parseErr) {
          console.error("Failed to parse error:", parseErr)
        }
      }

      alert("Failed to initiate Google login. Please try again.")
    }
  }

  // Adding tenant in progress
  if (isAddingTenant) {
    return (
      <div className="login-container" style={{
        '--primary-color': tenant?.theme?.primary_color || '#007bff'
      } as React.CSSProperties}>
        <div className="login-card">
          {tenant?.theme?.logo_url && (
            <img src={tenant.theme.logo_url} alt={tenant.tenant_name} style={{ height: 50, marginBottom: 20 }} />
          )}
          <h1 className="login-title">🔧 Setting up {tenant?.tenant_name}...</h1>

          <div style={{
            background: '#d1ecf1',
            border: '2px solid #17a2b8',
            borderRadius: '12px',
            padding: '24px',
            marginBottom: '20px',
            textAlign: 'center'
          }}>
            <div style={{
              width: '40px',
              height: '40px',
              border: '4px solid #f3f3f3',
              borderTop: '4px solid #17a2b8',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
              margin: '0 auto 20px'
            }}></div>
            <p style={{ margin: 0, fontSize: '16px', color: '#666' }}>
              Adding <strong>{tenant?.tenant_name}</strong> to your account...
            </p>
          </div>
          <style>{`
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          `}</style>
        </div>
      </div>
    )
  }

  // Logout in progress
  if (logoutTriggered.current || isLoggingOut) {
    return (
      <div className="login-container" style={{
        '--primary-color': tenant?.theme?.primary_color || '#007bff'
      } as React.CSSProperties}>
        <div className="login-card">
          {tenant?.theme?.logo_url && (
            <img src={tenant.theme.logo_url} alt={tenant.tenant_name} style={{ height: 50, marginBottom: 20 }} />
          )}
          <h1 className="login-title">🔄 Switching to {tenant?.tenant_name}...</h1>

          <div style={{
            background: '#fff3cd',
            border: '2px solid #ffc107',
            borderRadius: '12px',
            padding: '24px',
            marginBottom: '20px',
            textAlign: 'center'
          }}>
            <div style={{
              width: '40px',
              height: '40px',
              border: '4px solid #f3f3f3',
              borderTop: '4px solid #ffc107',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
              margin: '0 auto 20px'
            }}></div>
            <p style={{ margin: 0, fontSize: '16px', color: '#666' }}>
              Clearing previous session and preparing login for <strong>{tenant?.tenant_name}</strong>...
            </p>
          </div>
          <style>{`
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          `}</style>
        </div>
      </div>
    )
  }

  if (!tenant) {
    return <div className="login-container"><div className="login-card">Loading tenant...</div></div>
  }

  if (!sessionChecked) {
    return <div className="login-container"><div className="login-card">Checking session...</div></div>
  }

  if (loginChallenge && !session) {
    return <div className="login-container"><div className="login-card">Checking Hydra login...</div></div>
  }

  if (!flow && !loginChallenge) {
    return <div className="login-container"><div className="login-card">Loading login flow...</div></div>
  }

  if (!loginChallenge) {
    return (
      <div className="login-container" style={{
        '--primary-color': tenant.theme.primary_color
      } as React.CSSProperties}>
        <div className="login-card">
          <img src={tenant.theme.logo_url} alt={tenant.tenant_name} style={{ height: 50, marginBottom: 20 }} />
          <h1 className="login-title">Login to {tenant.tenant_name}</h1>
          <p style={{ fontSize: '12px', color: '#888', marginBottom: '20px' }}>
            Tenant: {tenant.tenant_id}
          </p>

          <form onSubmit={handleSubmit} className="login-form">
            <div className="form-group">
              <label>Email / Username</label>
              <input type="text" name="identifier" required />
            </div>
            <div className="form-group">
              <label>Password</label>
              <input type="password" name="password" required />
            </div>
            <button type="submit" className="btn-primary">
              Login
            </button>
          </form>

          <p className="register-text">
            Don't have an account?{" "}
            <button
              type="button"
              onClick={() => navigate(`/register?tenant_id=${tenant.tenant_id}&return_to=${encodeURIComponent(returnTo)}`)}
              className="btn-link"
            >
              Register here
            </button>
          </p>

          {tenant.features.google_login && (
            <button
              onClick={handleGoogleLogin}
              className="btn-google"
              style={{
                width: '100%',
                padding: '12px',
                marginTop: '10px',
                background: 'white',
                border: '1px solid #ddd',
                borderRadius: '6px',
                fontSize: '16px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '10px'
              }}
            >
              <img src="https://www.google.com/favicon.ico" alt="Google" style={{ width: 20, height: 20 }} />
              Continue with Google
            </button>
          )}
        </div>
      </div>
    )
  }

  return null
}