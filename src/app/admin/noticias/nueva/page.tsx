import { NewsForm } from "../news-form";

export const metadata = { title: "Nueva noticia — SIGeV" };

export default function NewNewsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Nueva noticia</h1>
      <NewsForm mode="create" />
    </div>
  );
}
