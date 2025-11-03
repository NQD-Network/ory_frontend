import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"

const HYDRA_PUBLIC_URL = import.meta.env.VITE_HYDRA_PUBLIC_URL
const HYDRA_CLIENT_ID = import.meta.env.VITE_HYDRA_CLIENT_ID || "my-frontend"
const HYDRA_REDIRECT_URI = import.meta.env.VITE_HYDRA_REDIRECT_URI

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
        const codeVerifier = localStorage.getItem("pkce_code_verifier")
        if (!codeVerifier) throw new Error("PKCE code verifier missing")

        const body = new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: HYDRA_REDIRECT_URI,
          client_id: HYDRA_CLIENT_ID,
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

        // Cleanup
        localStorage.removeItem("pkce_code_verifier")
        localStorage.removeItem("oauth_state")

        navigate("/")
      } catch (err: any) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }

    exchangeCode()
  }, [navigate])

  if (loading) return <div>Exchanging code for tokens...</div>
  if (error) return <div style={{ color: "red" }}>Error: {error}</div>
  return <div>Login successful! Redirecting...</div>
}
