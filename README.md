# ovaom.com — archive statique

Copie statique du site OVAOM (anciennement sur Squarespace), conservée en ligne après la fin de l'activité de l'entreprise.
Servie par GitHub Pages sur `www.ovaom.com` (fichier `CNAME`).

## Ce qui a changé par rapport au site Squarespace

- Toutes les pages, images, polices et le guide PDF sont hébergés dans ce dépôt (plus aucune dépendance à Squarespace).
- Supprimés : prise de rendez-vous Calendly, page et liens « Contactez-nous », formulaires, newsletter, panier, bandeau cookies, Google Analytics.
- `/contactez-nous` redirige vers l'accueil.
- Les catégories du blog ont des URL simplifiées (`/blog-ovaom/category/portraits`, etc.).
- Les vidéos YouTube/Vimeo restent intégrées depuis leurs plateformes.
- `assets/site.js` remplace les scripts Squarespace encore utiles (menu mobile, carrousels).

## Prévisualiser en local

```bash
python3 -m http.server 8000
```

puis ouvrir http://localhost:8000.

## Régénérer depuis le site Squarespace (tant qu'il est en ligne)

`tools/render.mjs` capture chaque page dans Chrome, `tools/build.mjs` la nettoie et télécharge les ressources.

```bash
cd tools && npm install
node render.mjs ../_raw seeds.txt     # seeds.txt : une URL par ligne (sitemap)
node build.mjs ../_raw ../_site && cp -R static/ ../_site/
```
