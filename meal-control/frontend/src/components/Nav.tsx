import React from 'react';
import { NavLink } from 'react-router-dom';

export default function Nav() {
  return (
    <nav className="nav">
      <div className="nav-brand">
        <span>🥗 PegPese<span className="dot"> ·</span> Refeições</span>
      </div>
      <div className="nav-links">
        <NavLink to="/scanner" className={({ isActive }) => isActive ? 'active' : ''}>
          📷 Scanner
        </NavLink>
        <NavLink to="/admin" className={({ isActive }) => isActive ? 'active' : ''}>
          📊 Admin
        </NavLink>
      </div>
    </nav>
  );
}
