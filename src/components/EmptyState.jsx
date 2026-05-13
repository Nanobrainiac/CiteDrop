import { SearchX } from 'lucide-react';

export default function EmptyState({ title = 'Nothing here yet', message = 'Try another search or create the first article.' }) {
  return (
    <div className="glass-panel rounded-lg p-10 text-center">
      <SearchX className="mx-auto h-10 w-10 text-acid" />
      <h2 className="mt-4 text-xl font-black">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-white/55">{message}</p>
    </div>
  );
}
