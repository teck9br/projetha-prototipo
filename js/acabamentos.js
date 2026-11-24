// Acabamentos do colégio: cada família de material do IFC (tag gravada pelo conversor no nome
// do material) recebe cor, brilho e uma textura procedural. O modelo do BIM não tem UV, então
// a textura é projetada em coordenadas de mundo (triplanar), com a normal tirada das derivadas.
import * as THREE from 'three';

const T = 512;
const cache = {};

function tela(desenhar) {
  const c = document.createElement('canvas');
  c.width = c.height = T;
  const g = c.getContext('2d');
  desenhar(g);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace; // é um multiplicador de detalhe, não uma cor
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  return tex;
}

// ruído de valor simples, repetível nas bordas
function ruido(g, escala, min, max, semente = 1) {
  const n = Math.ceil(T / escala) + 1;
  let s = semente * 9973;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const grade = Array.from({ length: n * n }, rnd);
  const at = (x, y) => grade[(y % (n - 1)) * n + (x % (n - 1))];
  const img = g.getImageData(0, 0, T, T);
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
    const fx = x / escala, fy = y / escala, ix = fx | 0, iy = fy | 0, tx = fx - ix, ty = fy - iy;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const v = (at(ix, iy) * (1 - sx) + at(ix + 1, iy) * sx) * (1 - sy) + (at(ix, iy + 1) * (1 - sx) + at(ix + 1, iy + 1) * sx) * sy;
    const k = (y * T + x) * 4, f = min + (max - min) * v;
    img.data[k] *= f; img.data[k + 1] *= f; img.data[k + 2] *= f;
  }
  g.putImageData(img, 0, 0);
}
const branco = g => { g.fillStyle = '#fff'; g.fillRect(0, 0, T, T); };
function pontos(g, qtd, cor, rMax) {
  for (let i = 0; i < qtd; i++) {
    g.fillStyle = cor; g.beginPath();
    g.arc(Math.random() * T, Math.random() * T, Math.random() * rMax + 0.4, 0, 7); g.fill();
  }
}

const TEXTURAS = {
  reboco: () => tela(g => { branco(g); ruido(g, 64, 0.985, 1, 3); ruido(g, 6, 0.975, 1, 5); }), // quase liso: manchas pareciam sujeira
  concreto: () => tela(g => {
    branco(g); ruido(g, 128, 0.8, 1, 7); ruido(g, 24, 0.9, 1, 8); ruido(g, 4, 0.94, 1, 9);
    pontos(g, 900, 'rgba(0,0,0,.18)', 1.3);
  }),
  porcelanato: () => tela(g => { // 1 peça por repetição; escala = tamanho da peça
    branco(g); ruido(g, 96, 0.9, 1, 11); ruido(g, 5, 0.97, 1, 12);
    g.fillStyle = 'rgba(40,40,40,.55)'; g.fillRect(0, 0, T, 3); g.fillRect(0, 0, 3, T);
  }),
  granito: () => tela(g => {
    branco(g); ruido(g, 40, 0.85, 1, 13);
    pontos(g, 5000, 'rgba(0,0,0,.35)', 1.4); pontos(g, 2500, 'rgba(255,255,255,.5)', 1.2);
  }),
  madeira: () => tela(g => { // tábuas na vertical, veio contínuo
    branco(g);
    for (let x = 0; x < T; x++) {
      const v = 0.8 + 0.2 * Math.sin(x * 0.35 + Math.sin(x * 0.05) * 3) * Math.sin(x * 0.11);
      g.fillStyle = `rgba(60,30,10,${(1 - v) * 0.9})`; g.fillRect(x, 0, 1, T);
    }
    ruido(g, 18, 0.88, 1, 15);
    g.fillStyle = 'rgba(30,15,5,.6)';
    for (let i = 0; i < 4; i++) g.fillRect(i * T / 4, 0, 2, T);
  }),
  grama: () => tela(g => {
    branco(g); ruido(g, 80, 0.75, 1.0, 17); ruido(g, 3, 0.7, 1.0, 18);
  }),
  telha: () => tela(g => {
    branco(g);
    for (let x = 0; x < T; x++) { const v = 0.82 + 0.18 * Math.cos(x / T * Math.PI * 16); g.fillStyle = `rgba(0,0,0,${1 - v})`; g.fillRect(x, 0, 1, T); }
    ruido(g, 64, 0.92, 1, 19);
  }),
  carpete: () => tela(g => { branco(g); ruido(g, 2, 0.8, 1, 21); ruido(g, 60, 0.92, 1, 22); }),
  terreno: () => tela(g => {
    branco(g); ruido(g, 160, 0.82, 1, 23); ruido(g, 8, 0.9, 1, 24);
    g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(0, 0, T, 2); g.fillRect(0, 0, 2, T); // placas de calçada
  }),
  folhagem: () => tela(g => { branco(g); ruido(g, 10, 0.55, 1.05, 25); }),
};
const textura = k => (cache[k] ??= TEXTURAS[k]());

// Fotos reais dos acabamentos especificados no Revit (pasta RVT/MATERIAIS), com rejunte opcional
function foto(nome, rejunte) {
  return (cache['foto:' + nome] ??= (() => {
    const c = document.createElement('canvas'); c.width = c.height = 1024;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = rejunte ? THREE.RepeatWrapping : THREE.MirroredRepeatWrapping;
    tex.anisotropy = 8;
    const img = new Image();
    img.onload = () => {
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0, 1024, 1024);
      if (rejunte) { g.fillStyle = 'rgba(60,58,55,.7)'; g.fillRect(0, 0, 1024, 4); g.fillRect(0, 0, 4, 1024); }
      tex.needsUpdate = true;
    };
    img.src = `assets/img/texturas/${nome}.webp`;
    return tex;
  })());
}

// tag -> receita. escala = metros por repetição da textura
const RECEITAS = {
  pintura:     { tex: 'reboco', escala: 3, rough: 0.92 },
  concreto:    { tex: 'concreto', escala: 2.4, rough: 0.95 },
  porcelanato: { foto: 'tokyo-grey', rejunte: true, escala: 1.2, rough: 0.35, env: 0.8, cor: 0xffffff },
  granito:     { tex: 'granito', escala: 0.6, rough: 0.25, env: 1 },
  madeira:     { foto: 'mdf-itapua', escala: 1.4, rough: 0.6, cor: 0xffffff },
  grama:       { tex: 'grama', escala: 3, rough: 1 },
  vegetacao:   { tex: 'folhagem', escala: 0.8, rough: 1 },
  telhado:     { tex: 'telha', escala: 1, rough: 0.45, metal: 0.6 },
  carpete:     { tex: 'carpete', escala: 0.5, rough: 1 },
  terreno:     { tex: 'terreno', escala: 2, rough: 0.95 },
  epoxi:       { tex: 'reboco', escala: 4, rough: 0.28, env: 1 },
  porta:       { rough: 0.5 },
  metal:       { rough: 0.3, metal: 0.85, env: 1.4, cor: 0xc4c8cc },
  aluminio_cor:{ rough: 0.4, metal: 0.35, env: 1.1, saturar: 1.15 },
  painel_cor:  { rough: 0.45, metal: 0.2, env: 0.9, saturar: 1.1 },
  acm_grafite: { rough: 0.38, metal: 0.45, env: 1.2 },
  acm_azul:    { rough: 0.38, metal: 0.4, env: 1.2 },
  acm_azul_corte: { rough: 0.38, metal: 0.4, env: 1.2 },
  acm_cinza:   { rough: 0.4, metal: 0.35, env: 1.1 },
};

function triplanar(m, tex, escala) {
  m.onBeforeCompile = sh => {
    sh.uniforms.tDetalhe = { value: tex };
    sh.uniforms.uEscala = { value: escala };
    sh.vertexShader = 'varying vec3 vWPos;\n' + sh.vertexShader.replace('#include <project_vertex>',
      '#include <project_vertex>\n vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = 'uniform sampler2D tDetalhe; uniform float uEscala; varying vec3 vWPos;\n' +
      sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      {
        vec3 nW = normalize(cross(dFdx(vWPos), dFdy(vWPos)));
        vec3 w = pow(abs(nW), vec3(6.0)); w /= (w.x + w.y + w.z);
        vec3 p = vWPos / uEscala;
        vec3 d = texture2D(tDetalhe, p.zy).rgb * w.x + texture2D(tDetalhe, p.xz).rgb * w.y + texture2D(tDetalhe, p.xy).rgb * w.z;
        diffuseColor.rgb *= d;
      }`);
  };
  m.customProgramCacheKey = () => 'tri';
}

// Gramado em volta do terreno (some na neblina, que tem a cor do fundo)
export function criarGramado(raio) {
  // borda some em degradê radial até o fundo
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  const rg = g.createRadialGradient(128, 128, 30, 128, 128, 128);
  rg.addColorStop(0, '#fff'); rg.addColorStop(0.55, '#fff'); rg.addColorStop(1, '#000');
  g.fillStyle = rg; g.fillRect(0, 0, 256, 256);
  const alpha = new THREE.CanvasTexture(c);
  const m = new THREE.MeshStandardMaterial({ color: 0x2b3d22, roughness: 1, transparent: true, alphaMap: alpha, depthWrite: false });
  triplanar(m, textura('grama'), 3);
  const chao = new THREE.Mesh(new THREE.CircleGeometry(raio, 64).rotateX(-Math.PI / 2), m);
  chao.receiveShadow = true;
  return chao;
}

// Peça que atravessa a platibanda: azul abaixo da linha inferior dela, grafite acima (render da fachada 2026)
const Y_PLATIBANDA = 22.3; // base da moldura no modelo (painel PLACA ISOESTE 11CM, ACM cinza, cota 22,3–24,4)
function corteNaPlatibanda(m) {
  const grafite = new THREE.Color().setRGB(0.24, 0.25, 0.27);
  m.onBeforeCompile = sh => {
    sh.uniforms.uCorte = { value: Y_PLATIBANDA };
    sh.uniforms.uAcima = { value: grafite };
    sh.vertexShader = 'varying vec3 vWPosC;\n' + sh.vertexShader.replace('#include <project_vertex>',
      '#include <project_vertex>\n vWPosC = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = 'uniform float uCorte; uniform vec3 uAcima; varying vec3 vWPosC;\n' +
      sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n if (vWPosC.y > uCorte) diffuseColor.rgb = uAcima;');
  };
  m.customProgramCacheKey = () => 'corte-platibanda';
}

export function criarAcabamento(orig) {
  const tag = (orig.name || '').replace(/\.\d+$/, '');
  if (tag === 'vidro') {
    // vidro claro espelhado (pranchas e render): pouco pigmento, reflexo forte do céu
    return new THREE.MeshPhysicalMaterial({
      name: tag, color: 0x5f86b0, metalness: 0.25, roughness: 0.02, ior: 1.5,
      transparent: true, opacity: 0.62, envMapIntensity: 2.6, side: THREE.DoubleSide,
      specularIntensity: 1,
    });
  }
  const r = RECEITAS[tag];
  const m = new THREE.MeshStandardMaterial({
    name: tag, color: orig.color.clone().convertSRGBToLinear(), // IFC traz cor em sRGB; o glTF leu como linear
    roughness: r?.rough ?? 0.85, metalness: r?.metal ?? 0,
    transparent: orig.transparent, opacity: orig.opacity,
  });
  if (r?.cor) m.color.set(r.cor);
  if (r?.saturar) { const hsl = {}; m.color.getHSL(hsl); m.color.setHSL(hsl.h, Math.min(1, hsl.s * r.saturar), hsl.l); }
  if (r?.env) m.envMapIntensity = r.env;
  if (tag === 'acm_azul_corte') corteNaPlatibanda(m);
  if (r?.tex) triplanar(m, textura(r.tex), r.escala);
  if (r?.foto) triplanar(m, foto(r.foto, r.rejunte), r.escala);
  return m;
}
