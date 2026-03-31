import {Route, Routes} from 'react-router-dom'
import RegisterPage from "./pages/RegisterPage.tsx";
import LoginPage from "./pages/LoginPage.tsx";
import AccountsPage from "./pages/AccountsPage.tsx";
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
          <Route path="/dashboard" element={<ProtectedRoute>
            <AccountsPage />
          </ProtectedRoute>}/>
        </Routes></>

  )
}

export default App
