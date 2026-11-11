import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { LangProvider } from './i18n/index.jsx';
import '@fontsource-variable/inter';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <LangProvider>
    <App />
  </LangProvider>,
);
