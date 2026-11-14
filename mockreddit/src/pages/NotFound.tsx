import { Link } from 'react-router-dom';
import { COMMUNITY, FEED_PATH } from '../config';

export default function NotFound() {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-10 text-center">
      <p className="text-4xl font-extrabold text-slate-300">404</p>
      <p className="mt-2 font-semibold">This page doesn&rsquo;t exist.</p>
      <Link to={FEED_PATH} className="mt-3 inline-block text-sm text-accent-dark underline">Go to r/{COMMUNITY}</Link>
    </div>
  );
}
