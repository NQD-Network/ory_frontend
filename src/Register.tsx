import { useEffect, useState, useRef } from "react"
import {
    Configuration,
    FrontendApi,
    RegistrationFlow,
    UiNode,
    UiNodeInputAttributes,
} from "@ory/client-fetch"
import { useLocation, useNavigate } from "react-router-dom"
import { getStoredTenant, detectTenant, getTenantFromQuery, storeTenantInfo, type TenantConfig } from "./config/tenants.config"

const basePath = import.meta.env.VITE_ORY_SDK_URL || "/kratos"

const ory = new FrontendApi(
    new Configuration({
        basePath,
        credentials: "include",
    }),
)

// 🔥 Helper to get tenant from multiple sources
function resolveTenantForRegistration(): TenantConfig | null {
  // Priority 1: Query parameter
  const queryTenant = getTenantFromQuery()
  if (queryTenant) {
    return queryTenant
  }

  // Priority 2: SessionStorage (survives OAuth redirects)
  const sessionTenantId = sessionStorage.getItem('google_oauth_tenant')
  if (sessionTenantId) {
    const tenant = getStoredTenant()
    if (tenant?.tenant_id === sessionTenantId) {
      return tenant
    }
  }

  // Priority 3: Cookie
  const cookies = document.cookie.split(';')
  const oauthTenantCookie = cookies.find(c => c.trim().startsWith('oauth_tenant='))
  if (oauthTenantCookie) {
    const cookieTenantId = oauthTenantCookie.split('=')[1]
    const tenant = getStoredTenant()
    if (tenant?.tenant_id === cookieTenantId) {
      return tenant
    }
  }

  // Priority 4: LocalStorage
  const stored = getStoredTenant()
  if (stored) {
    return stored
  }

  // Priority 5: Detect from hostname
  const detected = detectTenant()
  return detected
}

export default function Register() {
    const [flow, setFlow] = useState<RegistrationFlow | null>(null)
    const [tenant, setTenant] = useState<TenantConfig | null>(null)
    const [isGoogleFlow, setIsGoogleFlow] = useState(false)
    const [submitting, setSubmitting] = useState(false)
    const flowInitialized = useRef(false)
    
    const location = useLocation()
    const navigate = useNavigate()
    const searchParams = new URLSearchParams(location.search)
    const flowId = searchParams.get("flow")

    // 🔥 Detect tenant on mount with enhanced resolution
    useEffect(() => {
        const resolvedTenant = resolveTenantForRegistration()
        if (resolvedTenant) {
          setTenant(resolvedTenant)
          storeTenantInfo(resolvedTenant)
        }
    }, [])

    useEffect(() => {
        if (!tenant || flowInitialized.current) return

        const initFlow = async () => {
            try {
                let res: RegistrationFlow
                if (flowId) {
                    res = await ory.getRegistrationFlow({ id: flowId })
                    
                    // 🔥 Check if this is a Google OAuth flow
                    const hasGoogleTraits = res.ui.nodes.some((node: any) => 
                      node.group === 'oidc' && 
                      node.attributes?.name?.startsWith('traits.')
                    )
                    setIsGoogleFlow(hasGoogleTraits)
                    // If so, this might be a "add tenant" flow, not a new registration
                    try {
                        const session = await ory.toSession()
                        if (session?.identity) {
                            
                            // Check if email matches
                            const emailNode = res.ui.nodes.find((n: any) => n.attributes?.name === 'traits.email') as UiNode | undefined
                            const flowEmail = emailNode && "value" in emailNode.attributes ? (emailNode.attributes as UiNodeInputAttributes).value : undefined
                            const sessionEmail = session.identity.traits?.email
                            
                            if (flowEmail === sessionEmail) {
                                // Will be handled by the duplicate email logic below
                            }
                        }
                    } catch {
                        // No session - this is a genuine new registration
                    }
                    
                    flowInitialized.current = true
                } else {
                    // 🚀 Create new flow with tenant in return_to
                    const returnTo = searchParams.get("return_to") || tenant.post_logout_redirect_uri
                    const returnToWithTenant = `${window.location.origin}${window.location.pathname}?tenant_id=${tenant.tenant_id}&return_to=${encodeURIComponent(returnTo)}`
                    
                    const registrationUrl = `${basePath}/self-service/registration/browser?return_to=${encodeURIComponent(returnToWithTenant)}`
                    window.location.href = registrationUrl
                    return
                }
                setFlow(res)
            } catch (err) {
                flowInitialized.current = false
            }
        }
        initFlow()
    }, [flowId, tenant])

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!flow || !tenant || submitting) return

        setSubmitting(true)
        const form = new FormData(e.target as HTMLFormElement)

        // 🔥 Get CSRF token
        const csrfNode = flow.ui.nodes.find(
            (n: UiNode) => n.attributes && "name" in n.attributes && n.attributes.name === "csrf_token"
        ) as UiNode | undefined

        const csrfToken =
            csrfNode && "value" in csrfNode.attributes
                ? (csrfNode.attributes as UiNodeInputAttributes).value
                : undefined

        try {
            // 🔥 Get email from form or pre-filled value
            const email = (form.get("email") || form.get("traits.email")) as string

            // 🔥 CRITICAL FIX: Build traits with ARRAY for tenants
            const traits: any = {
                email: email,
                name: {
                    first: (form.get("first_name") || form.get("traits.name.first")) as string || "",
                    last: (form.get("last_name") || form.get("traits.name.last")) as string || "",
                },
                role: "user",
                tenants: [  // 🚀 THIS MUST BE AN ARRAY, NOT OBJECT
                    {
                        tenant_id: tenant.tenant_id,
                        role: "user",
                        projects: []
                    }
                ],
                primary_tenant: tenant.tenant_id
            }

            const updateBody: any = {
                method: isGoogleFlow ? "oidc" : "password",
                csrf_token: csrfToken,
                traits: traits,
            }

            // Add password only for password method
            if (!isGoogleFlow) {
                updateBody.password = form.get("password") as string
            }

            // 🔥 For Google OAuth, include provider
            if (isGoogleFlow) {
                updateBody.provider = "google"
            }

            // 🚀 Submit the registration
            const result = await ory.updateRegistrationFlow({
                flow: flow.id,
                updateRegistrationFlowBody: updateBody,
            })

            // Clean up OAuth tenant storage
            sessionStorage.removeItem('google_oauth_tenant')
            localStorage.removeItem('google_oauth_tenant')
            document.cookie = 'oauth_tenant=; path=/; max-age=0'

            if (result.session) {
                window.location.href = "/"
            } else {
                navigate(`/`)
            }
        } catch (err: any) {
            setSubmitting(false)
            
            // 🔥 CRITICAL: @ory/client-fetch wraps errors differently
            let errorData: any = null
            
            // Try to extract the actual response data
            if (err.response) {
                try {
                    errorData = await err.response.json()
                } catch (parseErr) {
                    console.error("Failed to parse error response:", parseErr)
                }
            }
            
            // 🔥 Handle specific errors
            if (errorData) {
                // Check if redirect is required
                if (errorData.redirect_browser_to) {
                    window.location.href = errorData.redirect_browser_to
                    return
                }
                
                // Check for duplicate email
                const messages = errorData.ui?.messages || []
                const nodes = errorData.ui?.nodes || []
                
                const duplicateError = messages.find((m: any) => 
                  m.text?.includes('already exists') || 
                  m.text?.includes('already taken') ||
                  m.text?.includes('An account with the same identifier')
                )
                
                if (duplicateError) {
                    // 🔥 User already exists - try to add tenant to existing identity
                    
                    if (confirm(
                        `This email is already registered.\n\n` +
                        `Would you like to add access to ${tenant.tenant_name} to your existing account?\n\n` +
                        `You'll need to login first.`
                    )) {
                        // Redirect to login with special flag to add tenant after login
                        sessionStorage.setItem('add_tenant_after_login', tenant.tenant_id)
                        const savedReturnTo = localStorage.getItem('google_oauth_return_to') || tenant.post_logout_redirect_uri
                        navigate(`/login?tenant_id=${tenant.tenant_id}&add_tenant=1&return_to=${encodeURIComponent(savedReturnTo)}`)

                    } else {
                        navigate(`/`)
                    }
                    return
                }
                
                // Show other validation errors
                const errorMessages = nodes
                  .filter((n: any) => n.messages && n.messages.length > 0)
                  .map((n: any) => n.messages.map((m: any) => m.text).join('\n'))
                  .join('\n')
                
                if (errorMessages) {
                    alert(`Registration Error:\n\n${errorMessages}`)
                } else {
                    alert('Registration failed. Please check your information and try again.')
                }
            } else {
                alert('Registration failed. Please try again.')
            }
        }
    }

    if (!tenant || !flow) {
        return (
            <div className="login-container">
                <div className="login-card">
                  <div style={{ textAlign: 'center' }}>
                    <div style={{
                      width: '40px',
                      height: '40px',
                      border: '4px solid #f3f3f3',
                      borderTop: '4px solid #3498db',
                      borderRadius: '50%',
                      animation: 'spin 1s linear infinite',
                      margin: '0 auto 20px'
                    }}></div>
                    Loading registration...
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

    // 🔥 Pre-fill values from flow (Google OAuth case)
    const getNodeValue = (name: string): string => {
        const node = flow.ui.nodes.find((n: any) => n.attributes?.name === name) as UiNode | undefined
        if (!node || !node.attributes) return ""
        const attrs = node.attributes as UiNodeInputAttributes
        return 'value' in attrs && typeof attrs.value === "string" ? attrs.value : ""
    }

    const emailValue = getNodeValue("traits.email")
    const firstNameValue = getNodeValue("traits.name.first")
    const lastNameValue = getNodeValue("traits.name.last")

    return (
        <div className="login-container" style={{ 
            '--primary-color': tenant.theme.primary_color 
        } as React.CSSProperties}>
            <div className="login-card">
                <img src={tenant.theme.logo_url} alt={tenant.tenant_name} style={{ height: 50, marginBottom: 20 }} />
                <h1 className="login-title">
                  {isGoogleFlow ? "Complete Registration" : "Register"} for {tenant.tenant_name}
                </h1>
                
                <div style={{
                    background: isGoogleFlow ? '#e8f5e9' : '#e3f2fd',
                    padding: '12px',
                    borderRadius: '6px',
                    marginBottom: '20px',
                    fontSize: '14px'
                }}>
                    <strong>{isGoogleFlow ? '🎉 Google Account Detected' : '✨ New Account'}</strong>
                    <p style={{ margin: '5px 0 0 0', color: '#666' }}>
                        {isGoogleFlow 
                          ? `Please confirm your details for ${tenant.tenant_name}`
                          : `You're creating an account for ${tenant.tenant_name}`
                        }
                    </p>
                </div>
                
                <form onSubmit={handleSubmit} className="login-form">
                    {/* Hidden fields for Google OAuth pre-filled values */}
                    {isGoogleFlow && (
                      <>
                        <input type="hidden" name="traits.email" value={emailValue} />
                        <input type="hidden" name="traits.name.first" value={firstNameValue} />
                        <input type="hidden" name="traits.name.last" value={lastNameValue} />
                      </>
                    )}
                    
                    <div className="form-group">
                        <label>First Name</label>
                        <input 
                          type="text" 
                          name="first_name" 
                          defaultValue={firstNameValue}
                          required 
                          readOnly={isGoogleFlow && firstNameValue !== ""}
                        />
                    </div>
                    <div className="form-group">
                        <label>Last Name</label>
                        <input 
                          type="text" 
                          name="last_name" 
                          defaultValue={lastNameValue}
                          required 
                          readOnly={isGoogleFlow && lastNameValue !== ""}
                        />
                    </div>
                    <div className="form-group">
                        <label>Email</label>
                        <input 
                          type="email" 
                          name="email" 
                          defaultValue={emailValue}
                          required 
                          readOnly={isGoogleFlow && emailValue !== ""}
                        />
                    </div>
                    
                    {!isGoogleFlow && (
                      <div className="form-group">
                          <label>Password</label>
                          <input type="password" name="password" required minLength={8} />
                      </div>
                    )}
                    
                    <div style={{
                      background: '#fff3cd',
                      padding: '12px',
                      borderRadius: '6px',
                      marginBottom: '20px',
                      fontSize: '13px',
                      border: '1px solid #ffc107'
                    }}>
                      <strong>📋 Registering for:</strong>
                      <div style={{ marginTop: '8px', color: '#666' }}>
                        <div>Tenant: <strong>{tenant.tenant_name}</strong></div>
                        <div>Tenant ID: <code>{tenant.tenant_id}</code></div>
                        <div>Role: <strong>User</strong></div>
                      </div>
                    </div>
                    
                    <button 
                      type="submit" 
                      className="btn-primary"
                      disabled={submitting}
                    >
                        {submitting ? "Processing..." : (isGoogleFlow ? "Complete Registration" : "Create Account")}
                    </button>
                </form>

                {!isGoogleFlow && (
                  <p className="register-text">
                      Already have an account?{" "}
                      <button
                          type="button"
                          onClick={() => navigate(`/login`)}
                          className="btn-link"
                      >
                          Login here
                      </button>
                  </p>
                )}
            </div>
        </div>
    )
}