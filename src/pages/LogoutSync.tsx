// src/pages/LogoutSync.tsx (or /logout-sync.tsx depending on your setup)
import { useEffect } from "react"
import { useNavigate } from "react-router-dom"

export default function LogoutSync() {
  const navigate = useNavigate()

  useEffect(() => {
    // Clear all Hydra tokens
    localStorage.clear()
    sessionStorage.clear()

    // Redirect to login page or home
    navigate("/login")
  }, [navigate])

  return <div>Logging out...</div>
}
