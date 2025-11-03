import React from "react"
import ReactDOM from "react-dom/client"
import { BrowserRouter, Routes, Route } from "react-router-dom"
import App from "./App"
import Login from "./Login"
import Register from "./Register"
import Callback from "./Callback"
import Consent from "./Consent"
import LogoutSync from "./pages/LogoutSync"
import KratosErrorPage from "./pages/KratosErrorPage"

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App msg="Ory + React" />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/callback" element={<Callback />} />
        <Route path="/consent" element={<Consent />} />
        <Route path="/logout-sync" element={<LogoutSync />} />
        <Route path="/error" element={<KratosErrorPage />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
)
