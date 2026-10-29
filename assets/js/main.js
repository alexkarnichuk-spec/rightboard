/* RightBoard — прогрессивное улучшение.
   Сайт полностью читается и работает без этого файла:
   меню доступно ссылками, галерея — обычные ссылки на фото.
   Здесь только удобства: прогресс чтения, закреплённая шапка,
   мобильное меню, лайтбокс и фасад видео. */
(() => {
  "use strict";

  const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /* ------------------------------------------- 1. Прогресс и состояние шапки */
  const header = $(".site-header");
  const progress = $(".progress");
  const sticky = $(".sticky-cta");

  if (header) {
    let raf = 0;
    const update = () => {
      raf = 0;
      const y = window.scrollY;
      header.classList.toggle("is-stuck", y > 8);

      if (progress) {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        const ratio = max > 0 ? Math.min(1, y / max) : 0;
        progress.style.transform = `scaleX(${ratio})`;
      }

      if (sticky) sticky.classList.toggle("is-visible", y > 460);
    };

    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
  }

  /* ------------------------------------------------------ 2. Мобильное меню */
  const toggle = $(".nav-toggle");
  const panel = $("#nav-panel");
  if (toggle && panel) {
    const setOpen = (open) => {
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "Закрыть меню" : "Открыть меню");
      panel.hidden = !open;
      panel.classList.toggle("is-open", open);
      document.documentElement.classList.toggle("nav-open", open);
    };

    toggle.addEventListener("click", () => setOpen(panel.hidden));
    panel.addEventListener("click", (event) => {
      if (event.target.closest("a")) setOpen(false);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !panel.hidden) {
        setOpen(false);
        toggle.focus();
      }
    });
  }

  /* ---------------------------------------------- 3. Появление по скроллу */
  if (!prefersReduced && "IntersectionObserver" in window) {
    const selector = [
      ".symptom-row",
      ".feature",
      ".spec-item",
      ".timeline__item",
      ".case",
      ".stat",
      ".offer-list li",
      ".contact-row",
      ".hero__media",
      ".media-band",
      ".compare",
      ".about__media",
    ].join(",");

    const candidates = $$(selector).filter(
      (el) => el.getBoundingClientRect().top > window.innerHeight * 0.92
    );

    candidates.forEach((el) => el.classList.add("reveal"));

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-in");
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.06 }
    );

    candidates.forEach((el) => observer.observe(el));
  }

  /* ------------------------------------------------------ 4. Фасад видео */
  $$(".video-facade").forEach((button) => {
    button.addEventListener("click", () => {
      const src = button.dataset.video;
      if (!src) return;
      const iframe = document.createElement("iframe");
      iframe.src = `${src}?autoplay=1`;
      iframe.title = "Видео: испытания МПК-доски";
      iframe.allow = "autoplay; fullscreen; picture-in-picture; encrypted-media";
      iframe.allowFullscreen = true;
      iframe.loading = "lazy";
      button.replaceChildren(iframe);
      button.disabled = true;
    });
  });

  /* --------------------------------------------------------- 5. Лайтбокс */
  const items = $$("[data-lightbox]");
  const box = $("#lightbox");

  if (items.length && box) {
    const img = $("img", box);
    let index = 0;
    let lastFocused = null;

    const render = (i) => {
      index = (i + items.length) % items.length;
      const link = items[index];
      img.src = link.dataset.full || link.getAttribute("href");
      img.alt = link.querySelector("img")?.alt || "";
    };

    const open = (i) => {
      lastFocused = document.activeElement;
      render(i);
      box.hidden = false;
      box.classList.add("is-open");
      document.documentElement.classList.add("nav-open");
      $(".lightbox__close", box).focus();
    };

    const close = () => {
      box.classList.remove("is-open");
      box.hidden = true;
      document.documentElement.classList.remove("nav-open");
      img.src = "";
      if (lastFocused) lastFocused.focus();
    };

    items.forEach((link, i) => {
      link.addEventListener("click", (event) => {
        event.preventDefault();
        open(i);
      });
    });

    $(".lightbox__close", box).addEventListener("click", close);
    $(".lightbox__nav--prev", box).addEventListener("click", () => render(index - 1));
    $(".lightbox__nav--next", box).addEventListener("click", () => render(index + 1));
    box.addEventListener("click", (event) => {
      if (event.target === box) close();
    });
    document.addEventListener("keydown", (event) => {
      if (box.hidden) return;
      if (event.key === "Escape") close();
      if (event.key === "ArrowLeft") render(index - 1);
      if (event.key === "ArrowRight") render(index + 1);
    });
  }

  /* ------------------------------- 6. Подсветка текущего раздела в меню */
  if ("IntersectionObserver" in window) {
    const links = $$(".site-nav a[href^='#']");
    const sections = links
      .map((link) => document.querySelector(link.getAttribute("href")))
      .filter(Boolean);

    const spy = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          links.forEach((link) => {
            if (link.getAttribute("href") === `#${entry.target.id}`) {
              link.setAttribute("aria-current", "page");
            } else {
              link.removeAttribute("aria-current");
            }
          });
        });
      },
      { rootMargin: "-45% 0px -50% 0px" }
    );

    sections.forEach((section) => spy.observe(section));
  }
})();
