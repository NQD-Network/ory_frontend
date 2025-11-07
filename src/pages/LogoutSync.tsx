// src/pages/LogoutSync.tsx
import { useEffect } from "react";
import { useLocation } from "react-router-dom";

export default function LogoutSync() {
  const location = useLocation();

  useEffect(() => {
    const processLogout = async () => {
      const params = new URLSearchParams(location.search);
      const returnTo = params.get("return_to") || "https://www.snm.jewelry";

      // ✅ Clear all tokens
      localStorage.clear();
      sessionStorage.clear();

      const KRATOS_PUBLIC_URL = import.meta.env.VITE_ORY_SDK_URL || "https://kratos.api.nqd.ai";

      try {
        // ✅ Step 1: Call Kratos logout browser flow
        const response = await fetch(
          `${KRATOS_PUBLIC_URL}/self-service/logout/browser?return_to=${encodeURIComponent(
            returnTo
          )}`,
          {
            credentials: "include", // ✅ Required for Kratos session cookie
          }
        );

        const data = await response.json();

        // ✅ Step 2: If logout_url received → redirect browser
        if (data.logout_url) {
          window.location.href = data.logout_url;
          return;
        }

        // ✅ Step 3: No logout_url? → just redirect to returnTo
        window.location.href = returnTo;
      } catch (error) {
        console.error("❌ Logout failed:", error);
        window.location.href = returnTo;
      }
    };

    processLogout();
  }, [location]);

  return <div>Logging out...</div>;
}