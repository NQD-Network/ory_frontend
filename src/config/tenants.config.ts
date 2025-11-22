// src/config/tenants.config.ts

const CALLBACK_URL = import.meta.env.VITE_HYDRA_REDIRECT_URI || "https://auth.nqd.ai/callback";
const MY_FRONTEND_URL = import.meta.env.VITE_MY_FRONTEND_URL || "https://www.snm.jewelry";
const NQD_CHATBOX_URL = import.meta.env.VITE_NQD_CHATBOX_URL || "https://nqd.ai";

export interface TenantConfig {
  tenant_id: string;
  tenant_name: string;
  hydra_client_id: string;
  redirect_uri: string;
  post_logout_redirect_uri: string;
  allowed_domains: string[];
  theme: {
    primary_color: string;
    logo_url: string;
    favicon_url: string;
  };
  features: {
    google_login: boolean;
    registration: boolean;
    password_reset: boolean;
  };
}

export const TENANTS: Record<string, TenantConfig> = {
  "my-frontend": {
    tenant_id: "my-frontend",
    tenant_name: "SNM Jewelry",
    hydra_client_id: "my-frontend",
    redirect_uri: CALLBACK_URL,
    post_logout_redirect_uri: MY_FRONTEND_URL,
    allowed_domains: ["localhost:3000","localhost:5173", "www.snm.jewelry"],
    theme: {
      primary_color: "#D4AF37",
      logo_url: "/snm-logo.png",
      favicon_url: "/snm-favicon.ico",
    },
    features: {
      google_login: true,
      registration: true,
      password_reset: true,
    },
  },
  "nqd-chatbox": {
    tenant_id: "nqd-chatbox",
    tenant_name: "NQD Chatbox",
    hydra_client_id: "nqd-chatbox",
    redirect_uri: CALLBACK_URL,
    post_logout_redirect_uri: NQD_CHATBOX_URL,
    allowed_domains: ["localhost:3001","localhost:5173", "nqd.ai"],
    theme: {
      primary_color: "#4F46E5",
      logo_url: "/NQD_logo.png",
      favicon_url: "/nqd-favicon.ico",
    },
    features: {
      google_login: true,
      registration: true,
      password_reset: true,
    },
  },
};

// ✅ Auto-detect tenant from hostname (CLIENT-SIDE ONLY)
// tenants.config.ts - FIXED detectTenant function
export function detectTenant(): TenantConfig {
  if (typeof window === 'undefined') {
    return TENANTS["nqd-chatbox"]; // ✅ Default for SSR
  }

  const hostname = window.location.hostname;
  const port = window.location.port;

  // 🔥 CRITICAL FIX: Port-based detection FIRST (more specific)
  if (port === '3001' || hostname.includes('nqd.ai')) {
    return TENANTS["nqd-chatbox"];
  } else if (port === '3000' || hostname.includes('snm.jewelry')) {
    return TENANTS["my-frontend"];
  }

  // 🔥 SPECIAL CASE: Port 5173 is login frontend - check stored tenant first
  if (port === '5173' || hostname.includes('auth.nqd.ai')) {
    const storedTenantId = localStorage.getItem('tenant_id');
    if (storedTenantId && TENANTS[storedTenantId]) {
      return TENANTS[storedTenantId];
    }
    
    // Check return_to parameter for context
    const params = new URLSearchParams(window.location.search);
    const returnTo = params.get('return_to');
    if (returnTo) {
      if (returnTo.includes('localhost:3001') || returnTo.includes('nqd')) {
        return TENANTS["nqd-chatbox"];
      } else if (returnTo.includes('localhost:3000') || returnTo.includes('snm')) {
        return TENANTS["my-frontend"];
      }
    }
  }

  return TENANTS["my-frontend"];
}

// Get tenant from query parameter (for login frontend)
export function getTenantFromQuery(): TenantConfig | null {
  if (typeof window === 'undefined') return null;

  const params = new URLSearchParams(window.location.search);
  const tenantId = params.get("tenant_id");
  
  if (tenantId && TENANTS[tenantId]) {
    return TENANTS[tenantId];
  }
  
  return null;
}

// Store tenant info (CLIENT-SIDE ONLY)
export function storeTenantInfo(tenant: TenantConfig) {
  if (typeof window === 'undefined') return;
  
  localStorage.setItem("tenant_id", tenant.tenant_id);
  localStorage.setItem("tenant_config", JSON.stringify(tenant));
}

// Retrieve stored tenant (CLIENT-SIDE ONLY)
export function getStoredTenant(): TenantConfig | null {
  if (typeof window === 'undefined') return null;

  const stored = localStorage.getItem("tenant_config");
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      return parsed;
    } catch {
      return null;
    }
  }
  return null;
}

// Get tenant by ID
export function getTenantById(tenantId: string): TenantConfig | null {
  return TENANTS[tenantId] || null;
}
// ---------- Helper: parse hostname:port from an arbitrary URL string ----------
function parseHostPortFromUrl(urlLike: string | null): { fullHost: string | null, hostname: string | null, port: string | null } {
  if (!urlLike) return { fullHost: null, hostname: null, port: null };

  // If it's already a bare host:port like "localhost:5173", allow that
  try {
    let candidate = urlLike;

    // Some return_to values may be encoded; decode
    try { candidate = decodeURIComponent(candidate); } catch { /* ignore */ }

    // If candidate doesn't look like an absolute URL, try to prepend a scheme to parse it
    if (!/^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//.test(candidate)) {
      candidate = candidate.startsWith('//') ? ('http:' + candidate) : ('http://' + candidate);
    }

    const u = new URL(candidate);
    const hostname = u.hostname;
    const port = u.port;
    const fullHost = port ? `${hostname}:${port}` : hostname;
    return { fullHost, hostname, port };
  } catch (err) {
    return { fullHost: null, hostname: null, port: null };
  }
}

// ---------- Detect tenant using a source URL (return_to/referrer) first ----------
export function detectTenantFromSource(sourceUrl?: string): TenantConfig {
  if (typeof window === 'undefined') {
    return TENANTS["nqd-chatbox"]; // SSR default
  }

  // 1) If caller passed a sourceUrl, try that
  let candidateSource = sourceUrl || null;

  // 2) Otherwise check return_to query param (common with Kratos/Hydra flows)
  if (!candidateSource) {
    const params = new URLSearchParams(window.location.search);
    const returnTo = params.get('return_to');
    if (returnTo) {
      candidateSource = returnTo;
    }
  }

  // 3) Otherwise use document.referrer (browser navigations)
  if (!candidateSource && document && document.referrer) {
    candidateSource = document.referrer;
  }

  // 4) Parse host:port from candidateSource
  const parsed = parseHostPortFromUrl(candidateSource);
  const fullHostFromSource = parsed.fullHost;

  if (fullHostFromSource) {
    for (const tenant of Object.values(TENANTS)) {
      if (tenant.allowed_domains.some(domain => fullHostFromSource.includes(domain))) {
        return tenant;
      }
    }
  } else {
    console.log('ℹ️ No valid source URL parsed (return_to/referrer missing or malformed)');
  }

  // 5) Fallback: use current window.location (old behavior)
  const hostname = window.location.hostname;
  const port = window.location.port;
  const fullHost = port ? `${hostname}:${port}` : hostname;

  for (const tenant of Object.values(TENANTS)) {
    if (tenant.allowed_domains.some(domain => fullHost.includes(domain))) {
      return tenant;
    }
  }

  // final fallback
  return TENANTS["my-frontend"];
}

// ---------- Resolve tenant (query -> localStorage -> source detection -> current) ----------
export const resolveTenant = (): TenantConfig => {
  if (typeof window === 'undefined') {
    return TENANTS["nqd-chatbox"];
  }

  // 1) Query param (explicit)
  const params = new URLSearchParams(window.location.search);
  const queryTenantId = params.get("tenant_id");
  if (queryTenantId && TENANTS[queryTenantId]) {
    storeTenantInfo(TENANTS[queryTenantId]);
    return TENANTS[queryTenantId];
  }

  // 2) localStorage
  const storedTenantId = localStorage.getItem("tenant_id");
  if (storedTenantId && TENANTS[storedTenantId]) {
    return TENANTS[storedTenantId];
  }

  // 3) Detect using return_to/referrer (preferred over current host)
  // Use the return_to param value (if any) as source, else referrer
  const returnTo = params.get('return_to') || document.referrer || undefined;
  const tenantFromSource = detectTenantFromSource(returnTo);
  if (tenantFromSource) {
    // store for future
    storeTenantInfo(tenantFromSource);
    return tenantFromSource;
  }

  // 4) final fallback (shouldn't get here because detectTenantFromSource falls back)
  const fallback = TENANTS["my-frontend"];
  storeTenantInfo(fallback);
  return fallback;
};


