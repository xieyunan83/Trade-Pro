import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initRuntimeConfig } from './services/runtimeConfig';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);

root.render(
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', color: '#64748b', fontFamily: 'Inter, sans-serif' }}>
    正在加载配置…
  </div>
);

initRuntimeConfig()
  .then(() => {
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  })
  .catch((err) => {
    console.error('Runtime config init failed', err);
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  });
