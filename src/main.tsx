import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import './index.css'
import { AuthProvider } from './context/AuthProvider'
import { Layout } from './pages/Layout'
import { Login } from './pages/Login'
import { Home } from './pages/Home'
import { Landing } from './pages/Landing'
import { OrgHome } from './pages/OrgHome'
import { EventHome } from './pages/EventHome'
import { ContestSetup } from './pages/ContestSetup'
import { ContestPeople } from './pages/ContestPeople'
import { ContestScores } from './pages/ContestScores'
import { ContestStandings } from './pages/ContestStandings'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route index element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route element={<Layout />}>
            <Route path="/dashboard" element={<Home />} />
            <Route path="/o/:orgId" element={<OrgHome />} />
            <Route path="/e/:eventId" element={<EventHome />} />
            <Route path="/c/:contestId/setup" element={<ContestSetup />} />
            <Route path="/c/:contestId/people" element={<ContestPeople />} />
            <Route path="/c/:contestId/scores" element={<ContestScores />} />
            <Route path="/c/:contestId/standings" element={<ContestStandings />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  </StrictMode>,
)
