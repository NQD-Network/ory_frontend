import { useEffect, useState } from "react"
import {
    Configuration,
    FrontendApi,
    RegistrationFlow,
    UiNode,
    UiNodeInputAttributes,
} from "@ory/client-fetch"
import { useLocation, useNavigate } from "react-router-dom"

const basePath = import.meta.env.VITE_ORY_SDK_URL || "/kratos"

const ory = new FrontendApi(
    new Configuration({
        basePath,
        credentials: "include",
    }),
)

export default function Register() {
    const [flow, setFlow] = useState<RegistrationFlow | null>(null)
    const location = useLocation()
    const navigate = useNavigate()
    const searchParams = new URLSearchParams(location.search)
    const flowId = searchParams.get("flow")

    useEffect(() => {
        const initFlow = async () => {
            try {
                let res: RegistrationFlow
                if (flowId) {
                    res = await ory.getRegistrationFlow({ id: flowId })
                } else {
                    window.location.href = "/kratos/self-service/registration/browser"
                    return
                }
                setFlow(res)
            } catch (err) {
                console.error("Failed to initialize registration flow:", err)
            }
        }
        initFlow()
    }, [flowId])

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!flow) return

        const form = new FormData(e.target as HTMLFormElement)

        const csrfNode = flow.ui.nodes.find(
            (n: UiNode) => n.attributes && "name" in n.attributes && n.attributes.name === "csrf_token"
        ) as UiNode | undefined

        const csrfToken =
            csrfNode && "value" in csrfNode.attributes
                ? (csrfNode.attributes as UiNodeInputAttributes).value
                : undefined

        try {
            const result = await ory.updateRegistrationFlow({
                flow: flow.id,
                updateRegistrationFlowBody: {
                    method: "password",
                    csrf_token: csrfToken,
                    traits: {
                        email: form.get("email") as string,
                        name: {
                            first: form.get("first_name") as string,
                            last: form.get("last_name") as string,
                        },
                        role: "user", // default role
                        projects: []  // default empty, permission viewer
                    },
                    password: form.get("password") as string,
                },
            })

            if (result.session) {
                window.location.href = "/"
            } else {
                navigate("/login")
            }
        } catch (err) {
            console.error("Registration error:", err)
        }
    }

    if (!flow) return <div>Loading registration flow...</div>

    return (
        <div className="login-container">
            <div className="login-card">
                <h1 className="login-title">Register</h1>
                <form onSubmit={handleSubmit} className="login-form">
                    <div className="form-group">
                        <label>First Name</label>
                        <input type="text" name="first_name" required />
                    </div>
                    <div className="form-group">
                        <label>Last Name</label>
                        <input type="text" name="last_name" required />
                    </div>
                    <div className="form-group">
                        <label>Email</label>
                        <input type="email" name="email" required />
                    </div>
                    <div className="form-group">
                        <label>Password</label>
                        <input type="password" name="password" required />
                    </div>
                    <button type="submit" className="btn-primary">Register</button>
                </form>

                <p className="register-text">
                    Already have an account?{" "}
                    <button
                        type="button"
                        onClick={() => navigate("/login")}
                        className="btn-link"
                    >
                        Login here
                    </button>
                </p>
            </div>
        </div>
    )

}
