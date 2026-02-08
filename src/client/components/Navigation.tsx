import { NavLink } from 'react-router-dom';
import './Navigation.css';

export default function Navigation() {
  return (
    <nav className="nav">
      <NavLink to="/" end className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
        Devices
      </NavLink>
      <NavLink
        to="/monitoring"
        className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
      >
        Monitoring
      </NavLink>
    </nav>
  );
}
