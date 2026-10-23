// Minimal replacement for the Squarespace scripts the static archive still needs:
// mobile menu, list carousels and banner slideshows.
document.addEventListener('DOMContentLoaded', () => {
  const body = document.body;

  // Mobile menu
  document.querySelectorAll('.header-burger-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const open = !body.classList.contains('header--menu-open');
      body.classList.toggle('header--menu-open', open);
      document.querySelectorAll('.header-burger-btn').forEach((b) => b.classList.toggle('burger--active', open));
      document.querySelectorAll('.header-menu').forEach((m) => m.setAttribute('aria-hidden', String(!open)));
    });
  });
  document.querySelectorAll('.header-menu a').forEach((a) => a.addEventListener('click', () => body.classList.remove('header--menu-open')));

  const bindArrows = (root, prefix, onMove) => {
    root.querySelectorAll(`${prefix}--left, .mobile-arrow-button--left`).forEach((b) => b.addEventListener('click', () => onMove(-1)));
    root.querySelectorAll(`${prefix}--right, .mobile-arrow-button--right`).forEach((b) => b.addEventListener('click', () => onMove(1)));
  };

  // Multi-column carousels
  document.querySelectorAll('.user-items-list-carousel').forEach((root) => {
    const track = root.querySelector('.user-items-list-carousel__slides');
    const slides = [...track.children];
    const paddings = slides.map((s) => s.style.padding);
    const maxCols = Number(root.dataset.maxColumns) || 3;
    const gap = Number(root.dataset.spaceBetweenSlidesValue) || 20;
    track.classList.add('is-static');
    track.style.gap = gap + 'px';
    let index = 0;
    let cols = maxCols;
    let step = 0;
    const layout = () => {
      const width = root.querySelector('.user-items-list-carousel__slides-revealer').clientWidth;
      cols = window.innerWidth < 768 ? Math.max(1, Math.min(2, maxCols - 2)) : maxCols;
      const w = (width - gap * (cols - 1)) / cols;
      // Squarespace's % paddings are relative to the slide itself, not the flex track
      slides.forEach((s, i) => {
        s.style.width = w + 'px';
        s.style.padding = paddings[i].replace(/([\d.]+)%/g, (_, v) => (v * w) / 100 + 'px');
      });
      step = w + gap;
      index = Math.min(index, Math.max(0, slides.length - cols));
      track.style.transform = `translateX(${-index * step}px)`;
    };
    bindArrows(root, '.user-items-list-carousel__arrow-button', (d) => {
      const last = Math.max(0, slides.length - cols);
      index = index + d > last ? 0 : index + d < 0 ? last : index + d;
      track.style.transform = `translateX(${-index * step}px)`;
    });
    window.addEventListener('resize', layout);
    layout();
  });

  // One-slide-at-a-time banner slideshows
  document.querySelectorAll('.user-items-list-banner-slideshow').forEach((root) => {
    const slides = [...root.querySelectorAll('.slides > li')];
    if (!slides.length) return;
    let index = Math.max(0, slides.findIndex((s) => !s.style.transform.includes('-9999')));
    const show = () => slides.forEach((s, i) => {
      s.style.transform = i === index ? 'translate3d(0,0,0)' : 'translate3d(-9999px,0,0)';
      s.setAttribute('aria-hidden', String(i !== index));
    });
    bindArrows(root, '.user-items-list-banner-slideshow__arrow-button', (d) => {
      index = (index + d + slides.length) % slides.length;
      show();
    });
    show();
  });
});
