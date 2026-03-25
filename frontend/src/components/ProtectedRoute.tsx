import { Navigate } from 'react-router-dom'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
    const token = localStorage.getItem('access_token')

    if (!token) {
        // YOUR CODE HERE — what should happen?
        return <Navigate to="/login" replace />
    }

    return children
}

export default ProtectedRoute
