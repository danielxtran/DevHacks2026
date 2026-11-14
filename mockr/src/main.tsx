import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { APP_NAME } from './config';
import { ToastProvider } from './lib/toast';
import Home from './pages/Home';
import NotFound from './pages/NotFound';
import PostDetail from './pages/PostDetail';
import Profile from './pages/Profile';
import Search from './pages/Search';
import './index.css';

// Dev-only route; tree-shaken out of production builds.
const DebugSearch = import.meta.env.DEV ? lazy(() => import('./pages/DebugSearch')) : null;

document.title = APP_NAME;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="/post/:id" element={<PostDetail />} />
            <Route path="/u/:username" element={<Profile />} />
            <Route path="/search" element={<Search />} />
            {DebugSearch && (
              <Route path="/_debug/search" element={<Suspense fallback={null}><DebugSearch /></Suspense>} />
            )}
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  </StrictMode>,
);
