import {Route, Routes, Navigate} from 'react-router-dom'
import RegisterPage from "./pages/RegisterPage.tsx";
import LoginPage from "./pages/LoginPage.tsx";
import AccountsPage from "./pages/AccountsPage.tsx";
import CategoriesPage from "./pages/CategoriesPage.tsx";
import MonthlyPlanView from "./pages/MonthlyPlanView.tsx";
import ProtectedRoute from "./components/ProtectedRoute.tsx";


function App() {
  return (
      <>
        <div>
          <h1>Tidal</h1>
        </div>

        <Routes>
          <Route path="/login" element={<LoginPage/>}/>
          <Route path="/register" element={<RegisterPage/>}/>
          {/* /dashboard now shows the Monthly Plan View — the primary screen */}
          <Route path="/dashboard" element={<ProtectedRoute>
            <MonthlyPlanView />
          </ProtectedRoute>}/>
          {/* /plan is the canonical path; /dashboard is kept as an alias */}
          <Route path="/plan" element={<ProtectedRoute>
            <MonthlyPlanView />
          </ProtectedRoute>}/>
          <Route path="/accounts" element={<ProtectedRoute>
            <AccountsPage />
          </ProtectedRoute>}/>
          <Route path="/categories" element={<ProtectedRoute>
            <CategoriesPage />
          </ProtectedRoute>}/>
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes></>

  )
}

export default App
