import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { SsoCallback } from './sso-callback';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('POS root element is missing');

const isCallback = window.location.pathname === '/auth/callback';
createRoot(root).render(<StrictMode>{isCallback ? <SsoCallback /> : <App />}</StrictMode>);
