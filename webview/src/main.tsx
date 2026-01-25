import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

// Import Tabulator styles
import 'tabulator-tables/dist/css/tabulator_simple.min.css';

// Development mode: load mock data when not in VS Code
if (import.meta.env.DEV) {
  // Check if we're NOT in a VS Code webview
  const isVsCodeWebview = typeof acquireVsCodeApi !== 'undefined';
  if (!isVsCodeWebview) {
    // Dynamic import to avoid bundling in production
    import('./devMock').then(({ initDevMock }) => {
      initDevMock();
    });
  }
}

// Mount the React app
const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);
