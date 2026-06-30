import { useEffect, useState } from "react";
import { Routes, Route, Link } from "react-router-dom";
import Home from "./pages/Home.js";
import NewAudit from "./pages/NewAudit.js";
import Runs from "./pages/Runs.js";
import RunDetail from "./pages/RunDetail.js";
import SettingsPage from "./pages/Settings.js";

function App() {
  const [platform, setPlatform] = useState<string>("");

  useEffect(() => {
    if (window.electronAPI?.getPlatform) {
      window.electronAPI.getPlatform().then(setPlatform);
    }
  }, []);

  return (
    <div className={`app platform-${platform}`}>
      <nav className="navbar">
        <Link to="/" className="brand" aria-label="Tardigrade">
          <img src="/tardi.png" alt="" className="brand-logo" />
          <span className="brand-tooltip">Tardigrade</span>
        </Link>
        <div className="nav-links">
          <Link to="/new">New Run</Link>
          <Link to="/runs">Run</Link>
          <Link to="/settings">Settings</Link>
        </div>
      </nav>
      <main className="main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/new" element={<NewAudit />} />
          <Route path="/runs" element={<Runs />} />
          <Route path="/runs/:id" element={<RunDetail />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
