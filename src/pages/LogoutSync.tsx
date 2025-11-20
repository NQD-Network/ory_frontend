// src/pages/LogoutSync.tsx
import { useEffect } from "react";
import { useLocation } from "react-router-dom";

export default function LogoutSync() {
  const location = useLocation();

  useEffect(() => {
    const processLogout = async () => {
      const params = new URLSearchParams(location.search);
      const returnTo = params.get("return_to") || "/login";

      // ✅ Clear all tokens from ALL storage
      localStorage.clear();
      sessionStorage.clear();
      
      // Also clear any specific token keys just to be sure
      ['access_token', 'refresh_token', 'id_token', 'oauth_state', 'pkce_code_verifier', 'oauth_nonce', 'redirect_uri'].forEach(key => {
        localStorage.removeItem(key);
        sessionStorage.removeItem(key);
      });

      const KRATOS_PUBLIC_URL = import.meta.env.VITE_ORY_SDK_URL || "https://kratos.api.nqd.ai";

      try {
        // ✅ Step 1: Try to get logout flow from Kratos
        const logoutResponse = await fetch(
          `${KRATOS_PUBLIC_URL}/self-service/logout/browser`,
          {
            method: "GET",
            credentials: "include", // ✅ Include cookies
            headers: {
              "Accept": "application/json"
            }
          }
        );

        if (logoutResponse.ok) {
          const data = await logoutResponse.json();
          
          // ✅ Step 2: If logout_token is present, submit it
          if (data.logout_token) {
            await fetch(
              `${KRATOS_PUBLIC_URL}/self-service/logout?token=${data.logout_token}`,
              {
                method: "GET",
                credentials: "include"
              }
            );
          }
        }
        
      } catch (error) {
        console.warn("⚠️ Kratos logout failed (this is OK if no session):", error);
        // Don't throw - just continue to redirect
      } finally {
        // ✅ Always redirect after attempting logout
        window.location.href = returnTo;
      }
    };

    processLogout();
  }, [location]);

  return (
    <div style={{ 
      display: 'flex', 
      justifyContent: 'center', 
      alignItems: 'center', 
      height: '100vh',
      fontFamily: 'system-ui'
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ 
          fontSize: '48px', 
          marginBottom: '20px' 
        }}>👋</div>
        <div style={{ fontSize: '18px' }}>Logging out...</div>
      </div>
    </div>
  );
}