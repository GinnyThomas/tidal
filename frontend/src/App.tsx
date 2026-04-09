import { Route, Routes, Navigate } from 'react-router-dom'
import RegisterPage from './pages/RegisterPage.tsx'
import LoginPage from './pages/LoginPage.tsx'
import AccountsPage from './pages/AccountsPage.tsx'
import CategoriesPage from './pages/CategoriesPage.tsx'
import MonthlyPlanView from './pages/MonthlyPlanView.tsx'
import TransactionsPage from './pages/TransactionsPage.tsx'
import SchedulesPage from './pages/SchedulesPage.tsx'
import ProtectedRoute from './components/ProtectedRoute.tsx'

// App defines the route tree only.
// The standalone <h1>Tidal</h1> header has been replaced by the Layout
// component's navigation bar (rendered inside each protected page).
// LoginPage and RegisterPage show the Tidal brand in their own card headers.

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      {/* /dashboard is the primary view — Monthly Plan */}
      <Route path="/dashboard" element={<ProtectedRoute><MonthlyPlanView /></ProtectedRoute>} />
      <Route path="/plan" element={<ProtectedRoute><MonthlyPlanView /></ProtectedRoute>} />
      <Route path="/accounts" element={<ProtectedRoute><AccountsPage /></ProtectedRoute>} />
      <Route path="/categories" element={<ProtectedRoute><CategoriesPage /></ProtectedRoute>} />
      <Route path="/transactions" element={<ProtectedRoute><TransactionsPage /></ProtectedRoute>} />
      <Route path="/schedules"    element={<ProtectedRoute><SchedulesPage /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  )
}

export default App
