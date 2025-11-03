import { useEffect, useState } from "react"

const KRATOS_BASE = import.meta.env.VITE_ORY_SDK_URL || "http://localhost:4433"

type KratosError = {
    id?: string
    error?: {
        message?: string
        reason?: string
        status_code?: number
        code?: number
    }
    ui?: {
        messages?: Array<{ text?: string; type?: string; id?: number }>
    }
    // Fallback catch-all
    [key: string]: any
}

export default function KratosErrorPage() {
    const [data, setData] = useState<KratosError | null>(null)
    const [loading, setLoading] = useState(true)
    const [err, setErr] = useState<string | null>(null)

    useEffect(() => {
        const params = new URLSearchParams(window.location.search)
        const errorId = params.get("error") || params.get("id")

        if (!errorId) {
            setErr("Missing error id in URL.")
            setLoading(false)
            return
        }

        ; (async () => {
            try {
                const res = await fetch(
                    `${KRATOS_BASE}/self-service/errors?error=${encodeURIComponent(
                        errorId
                    )}`,
                    { credentials: "include" }
                )

                if (!res.ok) {
                    const text = await res.text().catch(() => "")
                    throw new Error(`Failed to fetch error. ${res.status}: ${text}`)
                }

                const json = (await res.json()) as KratosError
                setData(json)
            } catch (e: any) {
                setErr(e.message || "Could not fetch error details.")
            } finally {
                setLoading(false)
            }
        })()
    }, [])

    if (loading) return <div>Loading error details…</div>

    if (err) {
        return (
            <div style={{ padding: 16 }}>
                <h1>Something went wrong</h1>
                <p>{err}</p>
                <button onClick={() => (window.location.href = "/")}>
                    Back to home
                </button>
            </div>
        )
    }

    const userMessage =
        data?.ui?.messages?.map((m) => m.text).filter(Boolean).join("\n") ||
        data?.error?.message ||
        "An unexpected error occurred."

    return (
        <div style={{ padding: 16, maxWidth: 720 }}>
            <h1>There was a problem</h1>
            <p style={{ whiteSpace: "pre-wrap" }}>{userMessage}</p>

            {/* Developer details for debugging */}
            <details style={{ marginTop: 16 }}>
                <summary>Technical details</summary>
                <pre style={{ overflowX: "auto" }}>
                    {JSON.stringify(data, null, 2)}
                </pre>
            </details>

            <div style={{ marginTop: 16 }}>
                <button onClick={() => (window.location.href = "/login")}>
                    Back to login
                </button>
            </div>
        </div>
    )
}