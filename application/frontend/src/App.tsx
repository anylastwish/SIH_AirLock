import { BrowserRouter, Routes, Route } from 'react-router-dom'
import InputPage from './pages/InputPage'
import LandingPage from './pages/LandingPage'
import MainApplication from './pages/MainApplication'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/input" element={<InputPage />} />
        <Route path="/app"element={<MainApplication />} />
      </Routes>
    </BrowserRouter>
  )
}
