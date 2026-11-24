// Ambientes: a seção fica fixa e o trilho de imagens anda na horizontal com a rolagem
// (desktop e celular). Com "reduzir movimento" ligado, vira carrossel nativo com scroll-snap.
(function () {
  const { gsap, ScrollTrigger } = window;
  gsap.registerPlugin(ScrollTrigger);
  const secao = document.getElementById('ambientes');
  const trilho = secao.querySelector('.amb-trilho');
  const distancia = () => Math.max(0, trilho.scrollWidth - innerWidth);

  // também no celular: rolar para baixo move as fotos para o lado (o arrastar lateral passava despercebido)
  gsap.matchMedia().add('(prefers-reduced-motion: no-preference)', () => {
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
