import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { COMMUNITY, FEED_PATH, SITE_NAME } from './config';
import { ToastProvider } from './lib/toast';
import Feed from './pages/Feed';
import NotFound from './pages/NotFound';
import PostDetail from './pages/PostDetail';
import './index.css';

// Dev-only route; tree-shaken out of production builds.
const DebugListing = import.meta.env.DEV ? lazy(() => import('./pages/DebugListing')) : null;

// Keep the tab title in sync with config.ts (index.html has a static fallback).
document.title = `${SITE_NAME} · r/${COMMUNITY}`;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Navigate to={FEED_PATH} replace />} />
            <Route path={FEED_PATH} element={<Feed />} />
            <Route path={`${FEED_PATH}/post/:id`} element={<PostDetail />} />
            {DebugListing && (
              <Route path="/_debug/listing" element={<Suspense fallback={null}><DebugListing /></Suspense>} />
            )}
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  </StrictMode>,
);
