import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Navigation from './components/Navigation';
import AdminPage from './pages/AdminPage';
import MonitoringPage from './pages/MonitoringPage';
import CheckDetailPage from './pages/CheckDetailPage';
import './App.css';

export default function App() {
  return (
    <BrowserRouter basename="/_admin">
      <div className="app">
        <header className="app-header">
          <img src="/logo-small.png" alt="Moltworker" className="header-logo" />
          <h1>Moltbot Admin</h1>
          <Navigation />
        </header>
        <main className="app-main">
          <Routes>
            <Route path="/" element={<AdminPage />} />
            <Route path="/monitoring" element={<MonitoringPage />} />
            <Route path="/monitoring/:checkId" element={<CheckDetailPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
