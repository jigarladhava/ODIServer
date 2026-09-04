import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { LiveValuesProvider } from './lib/live-values';
import { ProjectProvider } from './lib/project';
import { ThemeProvider } from './lib/theme';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter useTransitions={false}>
      <ThemeProvider>
        <ProjectProvider>
          <LiveValuesProvider>
            <App />
          </LiveValuesProvider>
        </ProjectProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
