import { useEffect, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import {
  Configuration,
  FrontendApi,
  LoginFlow,
  Session,
  UiNode,
  UiNodeInputAttributes,
} from "@ory/client-fetch"

const KRATOS_BASE = import.meta.env.VITE_ORY_SDK_URL || "/kratos"
const HYDRA_ADMIN_URL = "/hydra-admin/admin"

const ory = new FrontendApi(
  new Configuration({
    basePath: KRATOS_BASE,
    credentials: "include",
  })
)

export default function Login() {
  const [flow, setFlow] = useState<LoginFlow | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading] = useState(false)

  const location = useLocation()
  const navigate = useNavigate()
  const searchParams = new URLSearchParams(location.search)

  const flowId = searchParams.get("flow")
  const returnTo = searchParams.get("return_to") || "/"
  const loginChallenge = searchParams.get("login_challenge")

  // ------------------------
  // Fetch Kratos session
  // ------------------------
  useEffect(() => {
    async function fetchSession() {
      try {
        const s = await ory.toSession()
        setSession(s)
      } catch {
        setSession(null)
      }
    }
    fetchSession()
  }, [])

  // ------------------------
  // Handle Hydra login acceptance
  // ------------------------
  useEffect(() => {
    if (loginChallenge && session?.identity?.id) {
      fetch(
        `${HYDRA_ADMIN_URL}/oauth2/auth/requests/login/accept?login_challenge=${loginChallenge}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subject: session.identity.id }),
        }
      )
        .then((res) => res.json())
        .then((data) => {
          window.location.href = data.redirect_to
        })
        .catch((err) => console.error("Hydra login accept failed:", err))
    }
  }, [loginChallenge, session])

  // ------------------------
  // Initialize Kratos login flow
  // ------------------------
  useEffect(() => {
    const initFlow = async () => {
      if (loginChallenge) return // Hydra handled separately

      // If already logged in → redirect to app
      if (session) {
        navigate(returnTo)
        return
      }

      try {
        if (flowId) {
          const res = await ory.getLoginFlow({ id: flowId })
          setFlow(res)
        } else {
          // No flow ID → start browser login flow
          window.location.href = `${KRATOS_BASE}/self-service/login/browser?return_to=${encodeURIComponent(returnTo)}`
        }
      } catch (err) {
        console.error("Error initializing login flow:", err)
      }
    }

    initFlow()
  }, [flowId, loginChallenge, session])

  // ------------------------
  // Handle password login
  // ------------------------
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!flow) return

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
      await ory.updateLoginFlow({
        flow: flow.id,
        updateLoginFlowBody: {
          method: "password",
          identifier: form.get("identifier") as string,
          password: form.get("password") as string,
          csrf_token: csrfToken,
        },
      })

      window.location.href = returnTo
    } catch (err) {
      console.error("Login failed:", err)
    }
  }

  // ------------------------
  // Handle Google OIDC Login
  // ------------------------
const handleGoogleLogin = async () => {
  const flowId = new URLSearchParams(window.location.search).get("flow");

  try {
    const res = await fetch(`${KRATOS_BASE}/self-service/login?flow=${flowId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ provider: "google" }),
    });

    const data = await res.json();
console.log("Google login response:", data);
    // ✅ Perform redirect
    const redirectUrl =
      data.redirect_browser_to || data.error?.redirect_browser_to;
    if (redirectUrl) {
      window.location.href = redirectUrl;
    } else {
      console.error("Unexpected response:", data);
    }
  } catch (err) {
    console.error("Google login failed:", err);
  }
};


  // ------------------------
  // Render logic
  // ------------------------
  if (loginChallenge && !session) {
    return <div>Checking Hydra login...</div>
  }

  if (!flow && !loginChallenge) {
    return <div>Loading Kratos login flow...</div>
  }

  if (!loginChallenge) {
    return (
      <div className="login-container">
        <div className="login-card">
          <h1 className="login-title">Login</h1>

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
            Don’t have an account?{" "}
            <button
              type="button"
              onClick={() => navigate("/register")}
              className="btn-link"
            >
              Register here
            </button>
          </p>

          {/* <button
            type="button"
            className="btn-secondary"
            onClick={handleGoogleLogin}
            disabled={loading}
          >
            {loading ? "Redirecting..." : "Sign in with google"}
          </button> */}
        </div>
      </div>
    )
  }

  return null
}
