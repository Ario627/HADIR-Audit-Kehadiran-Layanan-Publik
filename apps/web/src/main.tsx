import '@fontsource-variable/archivo/standard.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-600.css';
import './styles/tokens.css';
import './styles/app.css';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { queryClient } from './lib/query';
import { registerServiceWorker } from './lib/sw-register';
import { router } from './router';

const container = document.getElementById('root');

if (container === null) {
  throw new Error('Elemen #root tidak ditemukan di index.html.');
}

registerServiceWorker();

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
