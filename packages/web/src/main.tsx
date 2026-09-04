import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { DirtyGuardProvider } from './lib/dirty';
import { LiveValuesProvider } from './lib/live-values';
import { ProjectProvider } from './lib/project';
import { ThemeProvider } from './lib/theme';
import { ToastProvider } from './lib/toast';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter useTransitions={false}>
      <ThemeProvider>
        <ToastProvider>
          <ProjectProvider>
            <DirtyGuardProvider>
              <LiveValuesProvider>
                <App />
              </LiveValuesProvider>
            </DirtyGuardProvider>
          </ProjectProvider>
        </ToastProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
