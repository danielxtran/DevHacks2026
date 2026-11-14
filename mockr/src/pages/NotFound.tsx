import { Link } from 'react-router-dom';
import { EmptyState, PageHeader } from '../components/ui';

export default function NotFound() {
  return (
    <>
      <PageHeader title="Not found" back />
      <EmptyState title="This page doesn’t exist">
        <Link to="/" className="text-accent hover:underline">Go home</Link>
      </EmptyState>
    </>
  );
}
