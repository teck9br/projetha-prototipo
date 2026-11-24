// Ambientes: a seção fica fixa e o trilho de imagens anda na horizontal com a rolagem
// (desktop e celular). Com "reduzir movimento" ligado, vira carrossel nativo com scroll-snap.
(function () {
  const { gsap, ScrollTrigger } = window;
  gsap.registerPlugin(ScrollTrigger);
  const secao = document.getElementById('ambientes');
  const trilho = secao.querySelector('.amb-trilho');
  const distancia = () => Math.max(0, trilho.scrollWidth - innerWidth);
  // progresso (0–1) em que cada bloco (texto de abertura e cada foto) fica centralizado na tela
  const pontosDeEncaixe = () => {
    const d = distancia() || 1;
    const blocos = [trilho.querySelector('.amb-intro'), ...trilho.querySelectorAll('.amb')];
    return blocos.map(el => Math.min(1, Math.max(0, (el.offsetLeft + el.offsetWidth / 2 - innerWidth / 2) / d)));
  };

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
        // no celular, ao parar de rolar, encaixa na foto mais próxima centralizada (antes ficava cortada na borda)
        snap: innerWidth <= 720 ? {
          snapTo: v => pontosDeEncaixe().reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a)),
          duration: { min: 0.2, max: 0.5 }, delay: 0.08, ease: 'power2.inOut',
        } : false,
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
