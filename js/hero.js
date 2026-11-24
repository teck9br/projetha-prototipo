// Hero: colégio construído pavimento por pavimento conforme a rolagem.
// Mecânica: um plano de corte horizontal sobe pelo prédio; cada categoria
// (estrutura, lajes, paredes, esquadrias...) vem um pouco atrás da anterior.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { criarAcabamento, criarGramado } from './acabamentos.js?v=33';

const { gsap, ScrollTrigger, Lenis } = window;
// recarregar no meio da página deixava o 3D no início e o texto no meio: sempre recomeça do topo
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
scrollTo(0, 0);
gsap.registerPlugin(ScrollTrigger);

const MOBILE = matchMedia('(max-width: 720px)').matches;
const REDUZIR = matchMedia('(prefers-reduced-motion: reduce)').matches;
const FUNDO = 0x080c18;
const SINAL = 0xf5c400;

// Quanto cada categoria fica atrás do nível da obra (metros)
// aço: a estrutura metálica (IFC do Tekla) sobe 5 m à frente do resto da obra
const ATRASO = { aco: -5, estrutura: 0, lajes: 0.4, cobertura: 0.6, circulacao: 1.0, paredes: 1.4, outros: 2.6, esquadrias: 3.2 };
const FOLGA_FINAL = 4; // o nível passa do topo para todas as categorias fecharem

// ---------- Renderer e cena ----------
const canvas = document.getElementById('cena');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !MOBILE, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, MOBILE ? 1.25 : 1.75));
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.localClippingEnabled = true;
renderer.shadowMap.enabled = !MOBILE;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(FUNDO);
const camera = new THREE.PerspectiveCamera(32, 1, 0.5, 3000);

const ceuLuz = new THREE.HemisphereLight(0xeef3ff, 0x4a4238, 1.1);
scene.add(ceuLuz);
const sol = new THREE.DirectionalLight(0xfff1dc, 2.8);
scene.add(sol, sol.target);

function redimensionar() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', redimensionar);
redimensionar();

// Céu só para reflexos (vidro e ACM): degradê azul > horizonte claro > chão
(function ceu() {
  const g = new THREE.SphereGeometry(100, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: 'varying vec3 v; void main(){ v = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
    fragmentShader: `varying vec3 v; void main(){
      float h = v.y;
      vec3 topo = vec3(0.23,0.45,0.80), hor = vec3(0.86,0.90,0.94), chao = vec3(0.30,0.32,0.30);
      vec3 c = h > 0. ? mix(hor, topo, pow(h, 0.6)) : mix(hor, chao, pow(-h, 0.4));
      gl_FragColor = vec4(c, 1.); }`,
  });
  const cena = new THREE.Scene(); cena.add(new THREE.Mesh(g, mat));
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(cena, 0.02).texture;
  scene.environmentIntensity = 0.7;
  pm.dispose();
})();

// ---------- Estado ----------
const planos = {};            // categoria -> THREE.Plane
const planoPaisagismo = new THREE.Plane(new THREE.Vector3(0, -1, 0), -1e4);
let pavimentos = [];          // { nome, cota, base }
let caixa, centro, raio, raioEsfera, tamPredio, baseY, topoY;
let nivel, nivelBorda, grade;
const alvoCam = new THREE.Vector3();

// ---------- Carregamento ----------
const barra = document.getElementById('barra');
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
Promise.all([
  loader.loadAsync('assets/models/colegio.glb?v=38', e => { if (e.total) barra.style.width = `${(e.loaded / e.total) * 100}%`; }),
  loader.loadAsync('assets/models/estrutura.glb?v=23').catch(err => { console.warn('estrutura metálica não carregou', err); return null; }),
]).then(([gltf, est]) => montar(gltf, est)).catch(err => {
  document.querySelector('#carregando span').textContent = 'Não foi possível carregar o modelo 3D.';
  console.error(err);
});

function montar(gltf, est) {
  const raiz = gltf.scene;
  // "A" da Educação Adventista (geometria do Revit): sai da lista de pavimentos e vira o logo da torre
  const logoA = raiz.getObjectByName('logo_a');
  if (logoA) raiz.remove(logoA);
  const nos = raiz.children; // P00 = terreno; P01..P07 = pavimentos em ordem de cota

  // Caixa do prédio (sem o terreno) para enquadrar câmera e régua
  caixa = new THREE.Box3();
  nos.slice(1).forEach(n => caixa.expandByObject(n));
  centro = caixa.getCenter(new THREE.Vector3());
  const tam = caixa.getSize(new THREE.Vector3());
  raio = Math.max(tam.x, tam.z);
  // Caixa só das paredes: a caixa geral inclui calçadas e entorno e deixava o prédio pequeno na tela
  const caixaPredio = new THREE.Box3();
  nos.slice(1).forEach(n => n.children.forEach(c => { if (c.userData?.categoria === 'paredes') caixaPredio.expandByObject(c); }));
  if (!caixaPredio.isEmpty()) {
    centro = caixaPredio.getCenter(new THREE.Vector3());
    tamPredio = caixaPredio.getSize(new THREE.Vector3());
  } else tamPredio = tam.clone();
  raioEsfera = tamPredio.length() / 2;
  baseY = caixa.min.y;
  topoY = caixa.max.y;

  // Materiais: um clone por mesh, com o plano de corte da sua categoria
  for (const cat of Object.keys(ATRASO)) planos[cat] = new THREE.Plane(new THREE.Vector3(0, -1, 0), -1e4);
  nos.forEach((pav, i) => {
    pav.traverse(o => {
      if (!o.isMesh) return;
      const cat = o.parent?.userData?.categoria ?? o.userData?.categoria ?? 'outros';
      const m = criarAcabamento(o.material);
      // terreno e rampas são superfícies curvas: normais suaves em vez de facetas
      // (normais suaves até 35°: rampas e taludes lisos, quinas de pilar continuam vivas)
      if (m.name === 'terreno' || m.name === 'concreto') { o.geometry = toCreasedNormals(o.geometry, THREE.MathUtils.degToRad(35)); m.flatShading = false; }
      else m.flatShading = true;
      if (i > 0) {
        m.clippingPlanes = [cat === 'paisagismo' ? planoPaisagismo : (planos[cat] ?? planos.outros)];
        m.clipShadows = true;
      }
      if (m.transparent) m.depthWrite = false;
      // janelas acendem no entardecer (4000 K, plafons das salas no projeto luminotécnico)
      if (m.name === 'vidro' && i > 0) {
        m.emissive = LUZ_SALAS.clone(); m.emissiveIntensity = 0;
        (janelas[i] ??= []).push(m);
      }
      o.material = m;
      o.castShadow = !m.transparent;
      o.receiveShadow = true;
    });
  });
  scene.add(raiz);

  if (logoA) scene.add(criarLogoTorre(logoA));

  // Estrutura metálica: alinhada pela matriz de coordenação que cada conversor gravou
  if (est) {
    const Ca = new THREE.Matrix4().fromArray(raiz.userData.coord);
    const Cs = new THREE.Matrix4().fromArray(est.scene.userData.coord);
    est.scene.applyMatrix4(Ca.multiply(Cs.invert()));
    const aco = new THREE.MeshStandardMaterial({
      name: 'aco', color: 0x7a838c, metalness: 0.7, roughness: 0.38, envMapIntensity: 1.3,
      flatShading: true, clippingPlanes: [planos.aco], clipShadows: true,
    });
    est.scene.traverse(o => { if (o.isMesh) { o.material = aco; o.castShadow = o.receiveShadow = true; } });
    scene.add(est.scene);
  }

  // Cotas reais do IFC -> altura no modelo. O deslocamento vem da laje de cada pavimento
  // (mediana), porque a caixa inteira é distorcida por escadas e pele de vidro.
  pavimentos = nos.slice(1).map(n => {
    const lajes = n.children.find(c => c.userData?.categoria === 'lajes');
    const b = new THREE.Box3().setFromObject(lajes ?? n);
    return { nome: rotulo(n.userData.pavimento ?? n.name), cota: n.userData.cota ?? 0, ref: b.max.y };
  });
  const difs = pavimentos.map(p => p.ref - p.cota).sort((a, b) => a - b);
  const desloc = difs[Math.floor(difs.length / 2)];
  pavimentos.forEach(p => { p.base = p.cota + desloc; });
  baseY = pavimentos[0].base - 0.5;
  topoY = Math.min(caixa.max.y, pavimentos.at(-1).base + 5);

  // Sol e sombra enquadrados no prédio
  sol.position.set(centro.x + raio * 0.6, topoY + raio * 0.9, centro.z + raio * 0.45);
  solDia.copy(sol.position);
  // sol de fim de tarde: baixo e de lado, sombras longas
  // atrás do prédio em relação à câmera final: fachada em penumbra, janelas acesas se destacam
  solTarde.set(centro.x - raio * 0.5, baseY + raio * 0.2, centro.z - raio * 1.1);
  sol.target.position.copy(centro);
  const sc = sol.shadow.camera;
  sc.left = sc.bottom = -raio * 0.75; sc.right = sc.top = raio * 0.75; sc.far = raio * 4;
  sol.shadow.mapSize.set(2048, 2048);
  sol.shadow.bias = -0.0004;
  sol.castShadow = !MOBILE;

  // Plano amarelo do "nível da obra"
  const larg = tamPredio.x * 1.06, prof = tamPredio.z * 1.06;
  nivel = new THREE.Mesh(
    new THREE.PlaneGeometry(larg, prof).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: SINAL, transparent: true, opacity: 0.045, depthWrite: false, side: THREE.DoubleSide })
  );
  nivelBorda = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints([[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => new THREE.Vector3(a * larg / 2, 0, b * prof / 2))),
    new THREE.LineBasicMaterial({ color: SINAL, transparent: true, opacity: 0.9 })
  );
  nivel.position.set(centro.x, baseY, centro.z);
  nivelBorda.position.copy(nivel.position);
  scene.add(nivel, nivelBorda);

  // Grade de prancha no chão, some conforme a obra avança
  const terreno = new THREE.Box3().setFromObject(nos[0]);
  const gramado = criarGramado(raio * 1.5);
  gramado.position.set(centro.x, (terreno.isEmpty() ? baseY : terreno.min.y) - 0.15, centro.z);
  scene.add(gramado);
  grade = new THREE.GridHelper(raio * 2.2, 44, 0x3a4246, 0x23292c);
  grade.material.transparent = true;
  grade.position.set(centro.x, (terreno.isEmpty() ? baseY : terreno.min.y) - 0.1, centro.z);
  scene.add(grade);
  scene.fog = new THREE.Fog(FUNDO, raio * 1.6, raio * 4.5);

  // Cúpula de céu: igual ao fundo de dia, degradê de entardecer no fim
  ceu = new THREE.Mesh(new THREE.SphereGeometry(raio * 5, 48, 24), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uTarde: { value: 0 }, uFundo: { value: new THREE.Color(FUNDO) } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform float uTarde; uniform vec3 uFundo; varying vec3 vDir;
      void main(){
        float h = clamp(vDir.y, -0.2, 1.0);
        vec3 horizonte = vec3(0.56, 0.24, 0.13), meio = vec3(0.17, 0.07, 0.16), topo = vec3(0.03, 0.05, 0.12);
        // brilho quente só numa faixa baixa; acima disso ameixa e marinho
        vec3 tarde = h < 0.0 ? mix(meio * 0.5, horizonte, smoothstep(-0.2, 0.0, h))
                   : h < 0.07 ? mix(horizonte, meio, smoothstep(0.0, 0.07, h)) : mix(meio, topo, smoothstep(0.07, 0.3, h));
        gl_FragColor = vec4(mix(uFundo, tarde, uTarde), 1.0);
        #include <colorspace_fragment>
      }`,
  }));
  ceu.position.copy(centro);
  ceu.renderOrder = -1;
  scene.add(ceu);

  montarRegua();
  iniciarRolagem();
  document.getElementById('carregando').classList.add('ok');
}

const rotulo = s => s.replace(/^P\d+_/, '').replace(/_/g, ' ').replace(/(\d)º Andar/, '$1º andar');

// ---------- Câmera ----------
// Quadros-chave: (progresso, azimute°, elevação°, zoom, altura do alvo 0–1).
// azimute 0 = de frente para a fachada principal; negativo = quina esquerda (painel laranja),
// positivo = quina direita (torre azul). zoom 1 = prédio inteiro cabendo na área livre da tela.
const QUADROS = [
  [0.00,   0, 80, 1.40, 0.00], // planta, vista de cima
  [0.12, -18, 54, 1.22, 0.15], // subsolo: desce pela quina esquerda
  [0.30, -30, 42, 1.25, 0.30], // térreo e 1º andar: andares em corte, dá para ver as salas
  [0.50,  -8, 36, 1.38, 0.40], // de frente: fachada subindo
  [0.70,  22, 30, 1.38, 0.45], // contorna para a torre azul
  [0.86,  38, 22, 1.42, 0.45], // cobertura
  [1.00,  30, 15, 1.45, 0.42], // fachada principal 3/4, entardecer
];
// depuração: ?cam=az,el,zoom,alvo fixa a câmera
const CAM_FIXA = new URLSearchParams(location.search).get('cam')?.split(',').map(Number);
if (CAM_FIXA) window.__dbg = { camera, scene }; // só depuração
const suave = t => t * t * (3 - 2 * t);
// Catmull-Rom: movimento contínuo, sem frear em cada quadro-chave
const cr = (p0, p1, p2, p3, t) => 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
function quadro(p) {
  let i = 0;
  while (i < QUADROS.length - 2 && p > QUADROS[i + 1][0]) i++;
  const q0 = QUADROS[Math.max(0, i - 1)], q1 = QUADROS[i], q2 = QUADROS[i + 1], q3 = QUADROS[Math.min(QUADROS.length - 1, i + 2)];
  const t = THREE.MathUtils.clamp((p - q1[0]) / (q2[0] - q1[0]), 0, 1);
  return [1, 2, 3, 4].map(k => cr(q0[k], q1[k], q2[k], q3[k], t));
}
// Área livre da tela onde o prédio deve caber (frações da largura/altura) e onde fica o centro dela
function areaLivre() {
  if (camera.aspect < 1) return { fw: 0.92, fh: 0.5, cx: 0.5, cy: 0.36 };   // celular: prédio acima do texto
  return { fw: 0.5, fh: 0.78, cx: 0.6, cy: 0.5 };                          // desktop: entre o texto e a régua
}
function posicionarCamera(p) {
  const [az, el, zoom, ty] = CAM_FIXA ?? quadro(p);
  const { fw, fh, cx, cy } = areaLivre();
  // distância para a esfera que envolve o prédio caber na área livre
  const vMeia = THREE.MathUtils.degToRad(camera.fov / 2);
  const hMeia = Math.atan(Math.tan(vMeia) * camera.aspect);
  const ang = Math.min(Math.atan(Math.tan(hMeia) * fw), Math.atan(Math.tan(vMeia) * fh));
  const dist = (raioEsfera / Math.sin(ang)) / zoom;
  const azR = THREE.MathUtils.degToRad(az), elR = THREE.MathUtils.degToRad(el);
  alvoCam.set(centro.x, baseY + (topoY - baseY) * ty, centro.z);
  camera.position.set(
    alvoCam.x + Math.sin(azR) * Math.cos(elR) * dist,
    alvoCam.y + Math.sin(elR) * dist,
    alvoCam.z + Math.cos(azR) * Math.cos(elR) * dist
  );
  camera.lookAt(alvoCam);
  // desloca a janela para o prédio ficar no centro da área livre
  const w = innerWidth, h = innerHeight;
  camera.setViewOffset(w, h, -(cx - 0.5) * w, -(cy - 0.5) * h, w, h);
}

// ---------- Logo da torre ----------
// Disco branco com o "A" em grafite no topo do bloco grafite do canto frontal direito
// (render FACHADA 2026). Coordenadas do modelo: bloco em x 82,1–84,3, cota 22,3–24,4, face em z −6,5.
const LOGO_CENTRO = new THREE.Vector3(83.2, 23.35, -6.42);
const LOGO_DIAMETRO = 1.75;
function criarLogoTorre(logoA) {
  const grupo = new THREE.Group();
  grupo.name = 'logo_torre';
  const corte = { clippingPlanes: [planos.paredes], clipShadows: true };
  const disco = new THREE.Mesh(new THREE.CircleGeometry(LOGO_DIAMETRO / 2, 64),
    new THREE.MeshStandardMaterial({ color: 0xf4f4f2, roughness: 0.4, metalness: 0.1, ...corte }));
  disco.position.copy(LOGO_CENTRO);
  // o "A" original: centraliza, escala para ~70% do disco e põe na frente do disco
  // a geometria vem quantizada (inteiros + escala no nó): converte para coordenadas reais em float
  logoA.updateMatrix();
  const src = logoA.geometry.attributes.position, v = new THREE.Vector3();
  const pos = new Float32Array(src.count * 3);
  for (let i = 0; i < src.count; i++) { v.fromBufferAttribute(src, i).applyMatrix4(logoA.matrix); v.toArray(pos, i * 3); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  if (logoA.geometry.index) geo.setIndex(Array.from(logoA.geometry.index.array));
  geo.computeBoundingBox();
  const caixaA = geo.boundingBox;
  const tamA = caixaA.getSize(new THREE.Vector3()), cA = caixaA.getCenter(new THREE.Vector3());
  geo.translate(-cA.x, -cA.y, -caixaA.max.z); // frente do "A" no plano z = 0
  const esc = (LOGO_DIAMETRO * 0.66) / Math.max(tamA.x, tamA.y);
  const a = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.5, flatShading: true, ...corte }));
  a.scale.setScalar(esc);
  a.position.set(LOGO_CENTRO.x, LOGO_CENTRO.y, LOGO_CENTRO.z + 0.02 + tamA.z * esc);
  grupo.add(disco, a);
  return grupo;
}

// ---------- Interface: régua, cota, legendas ----------
const reguaMarcas = document.getElementById('reguaMarcas');
const reguaNivel = document.getElementById('reguaNivel');
const reguaTrilho = document.querySelector('.regua-trilho');
const cotaValor = document.getElementById('cotaValor');
const legendas = [...document.querySelectorAll('[data-fase]')];
const fracRegua = y => THREE.MathUtils.clamp((y - baseY) / (topoY - baseY), 0, 1);

function montarRegua() {
  reguaMarcas.innerHTML = pavimentos.map(p => `<li style="bottom:${fracRegua(p.base) * 100}%">${p.nome}</li>`).join('');
}
const formatarCota = c => `${c < 0 ? '−' : c > 0 ? '+' : '±'}${Math.abs(c).toFixed(2).replace('.', ',')} m`;

let faseAtual = null;
function atualizarInterface(p, alturaObra) {
  // pavimento corrente: o último cuja base já foi ultrapassada
  let idx = -1;
  pavimentos.forEach((pv, i) => { if (alturaObra >= pv.base + 0.6) idx = i; });

  const f = fracRegua(alturaObra);
  reguaNivel.style.bottom = `${f * 100}%`;
  reguaTrilho.style.setProperty('--preenchido', `${f * 100}%`);
  [...reguaMarcas.children].forEach((li, i) => li.classList.toggle('feito', i <= idx));

  // cota: interpola entre as cotas reais do IFC
  let cota = idx < 0 ? pavimentos[0].cota : pavimentos[idx].cota;
  const prox = pavimentos[idx + 1];
  if (idx >= 0 && prox) cota += (prox.cota - cota) * THREE.MathUtils.clamp((alturaObra - pavimentos[idx].base - 0.6) / (prox.base - pavimentos[idx].base), 0, 1);
  cotaValor.textContent = formatarCota(p < 0.05 ? 0 : cota);

  const fase = p < 0.05 ? 'intro' : p > 0.95 ? 'fim' : String(Math.max(1, idx + 1));
  if (fase !== faseAtual) {
    faseAtual = fase;
    legendas.forEach(el => el.classList.toggle('ativa', el.dataset.fase === fase));
    document.querySelector('.abertura').style.opacity = fase === 'intro' ? 1 : 0;
  }
}

// ---------- Entardecer ----------
const LUZ_SALAS = new THREE.Color().setRGB(1.0, 0.80, 0.56, THREE.SRGBColorSpace);  // ~4000 K
const janelas = [];
const solDia = new THREE.Vector3(), solTarde = new THREE.Vector3();
const SOL_COR_DIA = new THREE.Color(0xfff1dc), SOL_COR_TARDE = new THREE.Color(0xff8a4c);
let ceu;
function entardecer(p) {
  const t = suave(THREE.MathUtils.clamp((p - 0.88) / 0.08, 0, 1));
  ceu.material.uniforms.uTarde.value = t;
  ceu.position.copy(camera.position); // céu centrado no olho: horizonte na altura certa
  sol.position.lerpVectors(solDia, solTarde, t);
  sol.color.lerpColors(SOL_COR_DIA, SOL_COR_TARDE, t);
  sol.intensity = 2.8 - 1.6 * t;
  ceuLuz.intensity = 1.1 - 0.6 * t;
  scene.environmentIntensity = 0.7 - 0.35 * t;
  // um pavimento por vez, de baixo para cima
  janelas.forEach((mats, i) => {
    const on = suave(THREE.MathUtils.clamp((p - (0.905 + (i - 1) * 0.011)) / 0.018, 0, 1));
    mats.forEach(m => { m.emissiveIntensity = on * 0.9; });
  });
}

// ---------- Rolagem ----------
function aplicar(p) {
  const prog = THREE.MathUtils.clamp((p - 0.05) / 0.82, 0, 1);
  const altura = baseY + prog * (topoY - baseY + FOLGA_FINAL);
  for (const [cat, plano] of Object.entries(planos)) plano.constant = altura - ATRASO[cat];
  const pais = THREE.MathUtils.clamp((p - 0.84) / 0.1, 0, 1);
  planoPaisagismo.constant = baseY + pais * (topoY - baseY);

  const alturaVisivel = Math.min(altura, topoY);
  nivel.position.y = nivelBorda.position.y = alturaVisivel;
  const mostrarNivel = prog > 0 && prog < 0.97;
  nivel.visible = nivelBorda.visible = mostrarNivel;
  grade.material.opacity = 0.9 * (1 - THREE.MathUtils.clamp(p / 0.45, 0, 1));
  grade.visible = grade.material.opacity > 0.01;

  posicionarCamera(p);
  atualizarInterface(p, altura);
  entardecer(p);

}

function iniciarRolagem() {
  const estado = { p: 0 };
  aplicar(0);

  if (!REDUZIR) {
    const lenis = new Lenis({ lerp: 0.1 });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add(t => lenis.raf(t * 1000));
    gsap.ticker.lagSmoothing(0);
  }

  gsap.to(estado, {
    p: 1,
    ease: 'none',
    scrollTrigger: { trigger: '#obra', start: 'top top', end: 'bottom bottom', scrub: REDUZIR ? true : 0.3 },
    onUpdate: () => aplicar(estado.p),
  });

  // redimensionar a janela recalcula o enquadramento na hora (antes só ao rolar)
  addEventListener('resize', () => aplicar(estado.p));
  gsap.ticker.add(() => renderer.render(scene, camera));
  ScrollTrigger.sort();
  ScrollTrigger.refresh();
}
