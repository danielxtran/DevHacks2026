import { Link } from 'react-router-dom';
import { searchPath, userPath } from '../config';
import { segments } from '../lib/text';

/**
 * Renders a post body safely: plain text everywhere, except #hashtags and
 * @mentions, which become <Link>s whose children are still plain text.
 * Never use dangerouslySetInnerHTML or an HTML/markdown parser here.
 */
export function RichText({ body, className = '' }: { body: string; className?: string }) {
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  return (
    <p className={`whitespace-pre-wrap break-words ${className}`}>
      {segments(body).map((s, i) => {
        if (s.type === 'hashtag') {
          return <Link key={i} to={searchPath(`#${s.tag}`)} onClick={stop} className="text-accent hover:underline">{s.value}</Link>;
        }
        if (s.type === 'mention') {
          return <Link key={i} to={userPath(s.username)} onClick={stop} className="text-accent hover:underline">{s.value}</Link>;
        }
        return s.value;
      })}
    </p>
  );
}
