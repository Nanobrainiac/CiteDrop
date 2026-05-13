import ArticleCard from './ArticleCard.jsx';
import EmptyState from './EmptyState.jsx';

export default function ArticleGrid({ articles }) {
  if (!articles?.length) return <EmptyState />;
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {articles.map((article) => <ArticleCard key={article.id} article={article} />)}
    </div>
  );
}
