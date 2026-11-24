// Ambientes: no desktop a seção fica fixa e o trilho de imagens anda na horizontal com a rolagem.
// No celular é um carrossel nativo com scroll-snap (CSS), sem pin.
(function () {
  const { gsap, ScrollTrigger } = window;
  gsap.registerPlugin(ScrollTrigger);
  const secao = document.getElementById('ambientes');
  const trilho = secao.querySelector('.amb-trilho');
  const distancia = () => Math.max(0, trilho.scrollWidth - innerWidth);

  gsap.matchMedia().add('(min-width: 721px) and (prefers-reduced-motion: no-preference)', () => {
    gsap.to(trilho, {
      x: () => -distancia(),
      ease: 'none',
      scrollTrigger: {
        trigger: secao,
        pin: true,
        scrub: 0.6,
        end: () => '+=' + distancia(),
        invalidateOnRefresh: true,
      },
    });
    // leve paralaxe dentro de cada imagem
    secao.querySelectorAll('.amb img').forEach(img => {
      gsap.fromTo(img, { xPercent: -6 }, {
        xPercent: 6, ease: 'none',
        scrollTrigger: { trigger: secao, start: 'top top', end: () => '+=' + distancia(), scrub: true, invalidateOnRefresh: true },
      });
    });
  });

  // imagens carregadas mudam a largura do trilho
  addEventListener('load', () => ScrollTrigger.refresh());
})();
