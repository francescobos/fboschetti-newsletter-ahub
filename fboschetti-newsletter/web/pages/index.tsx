/**
 * Pagina del plugin fboschetti-newsletter, servita sotto /plugins/fboschetti-newsletter.
 *
 * `meta` decide come compare nella sidebar dell'hub.
 */
export const meta = {
  title: "Fboschetti Newsletter",
  icon: "mail",
  sidebar: true,
  order: 100,
};

export default function Pagina() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold">Fboschetti Newsletter</h1>
      <p className="text-muted-foreground mt-2">Plugin Fboschetti Newsletter per Agentic Hub</p>
    </div>
  );
}
