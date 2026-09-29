import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import './index.css'
import { AuthProvider } from './context/AuthProvider'
import { Layout } from './pages/Layout'
import { Login } from './pages/Login'
import { Home } from './pages/Home'
import { OrgHome } from './pages/OrgHome'
import { EventHome } from './pages/EventHome'
import { ContestSetup } from './pages/ContestSetup'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="/o/:orgId" element={<OrgHome />} />
            <Route path="/e/:eventId" element={<EventHome />} />
            <Route path="/c/:contestId/setup" element={<ContestSetup />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  </StrictMode>,
)
