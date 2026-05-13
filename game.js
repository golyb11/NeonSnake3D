import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

const GRID_SIZE = 20;
const SNAKE_Y = 0.45;
const FOOD_Y = 0.38;
const INITIAL_SPEED = 0.15;
const BOOST_SPEED = 0.055;
const DOUBLE_PRESS_THRESHOLD = 350;
const MAX_GRID_MOVES_PER_FRAME = 4;

const COLORS = {
    bg: 0x0d0804,
    fog: 0x0d0804,
    head: 0xff0000,
    bodyStart: 0xffaa33,
    bodyEnd: 0xff6600,
    food: 0xff4400,
    foodEmissive: 0xff3300,
    obstacle: 0xff2200,
    obstacleEmissive: 0xff1100,
    grid: 0xffffff,
    gridSub: 0xdddddd,
    floor: 0xffffff,
    wall: 0x1a0c04,
    wallEmissive: 0x0d0500,
    accent: 0xff9944,
    laser: 0xff3300
};

let scene, camera, renderer, composer;
let snake, food, foodGlow;
let obstacles = [];
let raycaster = new THREE.Raycaster();
let mouse = new THREE.Vector2();
let score = 0;
let direction = new THREE.Vector3(1, 0, 0);
let nextDirection = new THREE.Vector3(1, 0, 0);
let lastMoveTime = 0;
let currentMoveInterval = INITIAL_SPEED;
let isGameOver = false;
let isBoostActive = false;
let boostKey = null;
let lastKeyCode = null;
let lastKeyTime = 0;
let prevBody = [];
const tmpHeadLook = new THREE.Vector3();
function setPrevBodyLength(n) {
    while (prevBody.length < n) prevBody.push(new THREE.Vector3());
    prevBody.length = n;
}
function copySnakeBodyToPrevBody() {
    if (!snake) return;
    setPrevBodyLength(snake.body.length);
    for (let i = 0; i < snake.body.length; i++) {
        prevBody[i].copy(snake.body[i]);
    }
}
function loadMemeBackdrop() {
    const loader = new THREE.TextureLoader();
    const imageUrl = new URL('assets/bg-meme-67.png', import.meta.url).href;
    loader.load(
        imageUrl,
        (texture) => {
            texture.colorSpace = THREE.SRGBColorSpace;
            if (renderer) texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
            texture.wrapS = THREE.ClampToEdgeWrapping;
            texture.wrapT = THREE.ClampToEdgeWrapping;
            const geo = new THREE.SphereGeometry(140, 40, 32);
            const mat = new THREE.MeshBasicMaterial({
                map: texture,
                side: THREE.BackSide,
                depthWrite: false,
                fog: false
            });
            const sky = new THREE.Mesh(geo, mat);
            sky.name = 'memeSky67';
            if (scene) scene.add(sky);
        },
        undefined,
        () => {
            if (scene && !scene.background) scene.background = new THREE.Color(COLORS.bg);
        }
    );
}
let trailParticles = [];
let isPaused = false;
let isLanguageMenuOpen = false;
let currentLanguage = 'ru';
let pauseCanvas = null;
let pauseCtx = null;
let ysdk = null;
let player = null;
let gameplayReportingActive = false;
let pausedByEscape = false;
let gameplaySdkAvailable = false;
let touchSwipeStartX = 0;
let touchSwipeStartY = 0;
let touchSwipeTracking = false;

const UI_STRINGS = {
    ru: {
        pause: 'Пауза',
        language: 'Язык',
        pauseLangRussian: 'Русский',
        pauseLangEnglish: 'English',
        hudScore: 'СЧЁТ',
        hudSpeed: 'СКОРОСТЬ',
        neon: 'NEON ',
        neonAccent: 'SNAKE',
        neonTail: ' 3D',
        startKeys: 'Управление: клавиши W A S D.',
        startBoost: 'Дважды нажмите направление и держите — ускорение.',
        startLaser: 'Клик — луч по препятствиям.',
        startTouch: 'На телефоне: проведите пальцем в нужную сторону.',
        startBtn: 'НАЧАТЬ',
        gameOverLine1Plain: 'СИСТЕМА ',
        gameOverLine1Error: 'СБОЙ',
        restartBtn: 'ЗАНОВО',
        finalScorePlain: 'Счёт: ',
    },
    en: {
        pause: 'Pause',
        language: 'Language',
        pauseLangRussian: 'Russian',
        pauseLangEnglish: 'English',
        hudScore: 'SCORE',
        hudSpeed: 'SPEED',
        neon: 'NEON ',
        neonAccent: 'SNAKE',
        neonTail: ' 3D',
        startKeys: 'Controls: keys W A S D.',
        startBoost: 'Double-tap a direction and hold to boost.',
        startLaser: 'Click to shoot lasers at obstacles.',
        startTouch: 'On phones: swipe in the direction to move.',
        startBtn: 'START',
        gameOverLine1Plain: 'SYSTEM ',
        gameOverLine1Error: 'CRASH',
        restartBtn: 'REBOOT',
        finalScorePlain: 'Score: '
    }
};

function txt(key) {
    const bundle = UI_STRINGS[currentLanguage] || UI_STRINGS.en;
    return bundle[key] !== undefined ? bundle[key] : (UI_STRINGS.en[key] ?? key);
}

function t(key) {
    return txt(key);
}

function deriveLanguageFromSdkCode(langRaw) {
    const code = String(langRaw || 'ru').toLowerCase().split('-')[0];
    if (['ru', 'be', 'kk', 'uk', 'uz'].includes(code)) return 'ru';
    return 'en';
}

function gameplaySdkNotifyStart() {
    if (!gameplaySdkAvailable || !ysdk?.features?.GameplayAPI?.start || gameplayReportingActive) return;
    ysdk.features.GameplayAPI.start();
    gameplayReportingActive = true;
}

function gameplaySdkNotifyStop() {
    if (!gameplaySdkAvailable || !ysdk?.features?.GameplayAPI?.stop || !gameplayReportingActive) return;
    ysdk.features.GameplayAPI.stop();
    gameplayReportingActive = false;
}

function sdkSendLoadingReady() {
    try {
        ysdk?.features?.LoadingAPI?.ready?.();
    } catch (_) {}
}

function syncUILayoutLanguage() {
    const scoreLbl = document.getElementById('hud-score-label');
    const speedLbl = document.getElementById('hud-speed-label');
    const startHeading = document.getElementById('start-heading');
    const keysLine = document.getElementById('start-line-keys');
    const boostLine = document.getElementById('start-line-boost');
    const laserLine = document.getElementById('start-line-laser');
    const touchLine = document.getElementById('start-line-touch');
    const goHeading = document.getElementById('game-over-heading');
    const plainFinal = document.getElementById('final-score-plain');
    if (scoreLbl) scoreLbl.textContent = txt('hudScore');
    if (speedLbl) speedLbl.textContent = txt('hudSpeed');
    if (startHeading) {
        startHeading.innerHTML =
            `<span>${txt('neon')}</span><span class="accent">${txt('neonAccent')}</span><span>${txt('neonTail')}</span>`;
    }
    if (keysLine) keysLine.textContent = txt('startKeys');
    if (boostLine) boostLine.textContent = txt('startBoost');
    if (laserLine) laserLine.textContent = txt('startLaser');
    if (touchLine) touchLine.textContent = txt('startTouch');
    if (plainFinal) plainFinal.textContent = txt('finalScorePlain');
    if (goHeading) {
        goHeading.innerHTML =
            `<span>${txt('gameOverLine1Plain')}</span><span class="error">${txt('gameOverLine1Error')}</span>`;
    }
    if (startBtn) startBtn.textContent = txt('startBtn');
    if (restartBtn) restartBtn.textContent = txt('restartBtn');
}

const scoreEl = document.getElementById('score');
const speedFillEl = document.getElementById('speed-fill');
const overlayEl = document.getElementById('overlay');
const startScreen = document.getElementById('start-screen');
const gameOverScreen = document.getElementById('game-over-screen');
const finalScoreEl = document.getElementById('final-score');
const startBtn = document.getElementById('start-btn');
const restartBtn = document.getElementById('restart-btn');

syncUILayoutLanguage();

class Snake {
    constructor() {
        this.body = [
            new THREE.Vector3(0, SNAKE_Y, 0),
            new THREE.Vector3(-1, SNAKE_Y, 0),
            new THREE.Vector3(-2, SNAKE_Y, 0)
        ];
        this.meshSegments = [];
        this.init();
    }
    init() {
        if (!scene) {
            console.warn('Scene not initialized');
            return;
        }
        

        this.meshSegments.forEach(m => scene.remove(m));
        this.meshSegments = [];
        

        this.body.forEach((pos, i) => {
            const isHead = i === 0;
            const size = isHead ? 0.9 : 0.8;
            const geometry = new THREE.BoxGeometry(size, size, size, 2, 2, 2);
            const t = i / Math.max(this.body.length - 1, 1);
            const color = new THREE.Color().lerpColors(
                new THREE.Color(COLORS.bodyStart),
                new THREE.Color(COLORS.bodyEnd),
                t
            );
            const material = new THREE.MeshStandardMaterial({
                color: isHead ? COLORS.head : color,
                emissive: isHead ? COLORS.head : color,
                emissiveIntensity: isHead ? 2.5 : 1.5,
                roughness: 0.25,
                metalness: 0.2
            });
            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.copy(pos);
            scene.add(mesh);
            this.meshSegments.push(mesh);
            if (isHead) {
                const eyeGeo = new THREE.SphereGeometry(0.12, 8, 8);
                const eyeMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
                const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
                eyeL.position.set(0.25, 0.2, 0.4);
                mesh.add(eyeL);
                const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
                eyeR.position.set(-0.25, 0.2, 0.4);
                mesh.add(eyeR);
                const pupilGeo = new THREE.SphereGeometry(0.05, 4, 4);
                const pupilMat = new THREE.MeshBasicMaterial({ color: COLORS.food });
                const pupilL = new THREE.Mesh(pupilGeo, pupilMat);
                pupilL.position.set(0.25, 0.15, 0.5);
                mesh.add(pupilL);
                const pupilR = new THREE.Mesh(pupilGeo, pupilMat);
                pupilR.position.set(-0.25, 0.15, 0.5);
                mesh.add(pupilR);
            }
        });
    }
    update(head) {
        this.body.unshift(head);
        this.body.pop();
    }
    grow(head) {
        this.body.unshift(head);
        const t = Math.min(this.body.length / 15, 1);
        const color = new THREE.Color().lerpColors(
            new THREE.Color(COLORS.bodyStart),
            new THREE.Color(COLORS.bodyEnd),
            t
        );
        const geometry = new THREE.BoxGeometry(0.8, 0.8, 0.8, 2, 2, 2);
        const material = new THREE.MeshStandardMaterial({
            color: color,
            emissive: color,
            emissiveIntensity: 1.5,
            roughness: 0.25,
            metalness: 0.2
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.copy(this.body[this.body.length - 1]);
        mesh.position.y = SNAKE_Y;
        scene.add(mesh);
        this.meshSegments.push(mesh);
        this.updateColors();
    }
    updateColors() {
        this.meshSegments.forEach((mesh, i) => {
            if (i === 0) {
                mesh.material.color.set(COLORS.head);
                mesh.material.emissive.set(COLORS.head);
                return;
            }
            const t = i / Math.max(this.body.length - 1, 1);
            const color = new THREE.Color().lerpColors(
                new THREE.Color(COLORS.bodyStart),
                new THREE.Color(COLORS.bodyEnd),
                t
            );
            mesh.material.color.copy(color);
            mesh.material.emissive.copy(color);
        });
    }
    checkCollision(pos) {
        if (Math.abs(pos.x) > GRID_SIZE / 2 || Math.abs(pos.z) > GRID_SIZE / 2) return true;
        for (let i = 1; i < this.body.length; i++) {
            if (this.body[i].x === pos.x && this.body[i].z === pos.z) return true;
        }
        return false;
    }
    reset() {
        this.meshSegments.forEach(m => scene.remove(m));
        this.body = [
            new THREE.Vector3(0, SNAKE_Y, 0),
            new THREE.Vector3(-1, SNAKE_Y, 0),
            new THREE.Vector3(-2, SNAKE_Y, 0)
        ];
        this.meshSegments = [];
        this.init();
    }
}

function ensureSnakeVisible() {
    if (!snake || !scene) return;
    if (snake.meshSegments.length !== snake.body.length) {
        snake.init();
    }
    snake.body.forEach((part) => {
        part.y = SNAKE_Y;
    });
    snake.meshSegments.forEach((mesh, index) => {
        mesh.visible = true;
        mesh.position.y = snake.body[index]?.y ?? SNAKE_Y;
    });
}

function init() {
    try {
        scene = new THREE.Scene();
        scene.background = null;
        scene.fog = new THREE.FogExp2(COLORS.fog, 0.019);
        camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
        camera.position.set(0, 15, 13);
        camera.lookAt(0, 0, 0);
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setClearColor(0x0d0804, 0);
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.15;
        const container = document.getElementById('game-container');
        if (!container) throw new Error("Game container not found!");
        container.insertBefore(renderer.domElement, container.firstChild);
        loadMemeBackdrop();
        const renderScene = new RenderPass(scene, camera);
        const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
        bloomPass.threshold = 0.15;
        bloomPass.strength = 1.0;
        bloomPass.radius = 0.5;
        composer = new EffectComposer(renderer);
        composer.addPass(renderScene);
        composer.addPass(bloomPass);
        const ambientLight = new THREE.AmbientLight(0x332211, 0.5);
        scene.add(ambientLight);
        const mainLight = new THREE.DirectionalLight(0xffeedd, 0.7);
        mainLight.position.set(10, 20, 5);
        mainLight.castShadow = true;
        mainLight.shadow.mapSize.width = 1024;
        mainLight.shadow.mapSize.height = 1024;
        mainLight.shadow.camera.near = 0.5;
        mainLight.shadow.camera.far = 100;
        mainLight.shadow.camera.left = -20;
        mainLight.shadow.camera.right = 20;
        mainLight.shadow.camera.top = 20;
        mainLight.shadow.camera.bottom = -20;
        scene.add(mainLight);
        const pointLight1 = new THREE.PointLight(COLORS.accent, 1.8, 30);
        pointLight1.position.set(0, 8, 0);
        scene.add(pointLight1);
        const pointLight2 = new THREE.PointLight(COLORS.food, 1.2, 20);
        pointLight2.position.set(0, 3, 0);
        scene.add(pointLight2);
        const gridHelper = new THREE.GridHelper(GRID_SIZE, GRID_SIZE, COLORS.grid, COLORS.gridSub);
        gridHelper.position.y = -0.5;
        scene.add(gridHelper);
        const floorGeo = new THREE.PlaneGeometry(GRID_SIZE + 2, GRID_SIZE + 2);
        const floorMat = new THREE.MeshStandardMaterial({ color: COLORS.floor, roughness: 0.5, metalness: 0.1 });
        const floor = new THREE.Mesh(floorGeo, floorMat);
        floor.rotation.x = -Math.PI / 2;
        floor.position.y = -0.51;
        floor.receiveShadow = true;
        scene.add(floor);
        createBorderWalls();
        pauseCanvas = document.createElement('canvas');
        pauseCanvas.width = window.innerWidth;
        pauseCanvas.height = window.innerHeight;
        pauseCanvas.style.cssText = 'position:absolute;top:0;left:0;z-index:5;pointer-events:none;display:none;';
        pauseCtx = pauseCanvas.getContext('2d');
        container.appendChild(pauseCanvas);
        snake = new Snake();
        ensureSnakeVisible();
        
        copySnakeBodyToPrevBody();
        spawnFood();
        spawnInitialObstacles();
        
        window.addEventListener('keydown', handleInput);
        window.addEventListener('keyup', handleKeyUp);
        window.addEventListener('resize', onWindowResize);
        window.addEventListener('mousedown', handleMouseDown);
        window.addEventListener('touchstart', handleTouchStart, { passive: true });
        window.addEventListener('touchend', handleTouchEnd, { passive: true });
        
        window.addEventListener('mousemove', (e) => {
            mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
            mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
        });
        if (startBtn) startBtn.addEventListener('click', startGame);
        if (restartBtn) restartBtn.addEventListener('click', startGame);
        document.addEventListener('visibilitychange', handleVisibilityChange);
        initYandexGames();
        animate();
    } catch (error) {
        console.error("Initialization failed:", error);
    }
}

function createBorderWalls() {
    const half = GRID_SIZE / 2;
    const wallMat = new THREE.MeshStandardMaterial({
        color: COLORS.wall,
        emissive: COLORS.wallEmissive,
        emissiveIntensity: 0.4,
        roughness: 0.5,
        metalness: 0.4,
        transparent: true,
        opacity: 0.5
    });
    const positions = [
        { x: 0, z: -half, w: GRID_SIZE, d: 0.3 },
        { x: 0, z: half, w: GRID_SIZE, d: 0.3 },
        { x: -half, z: 0, w: 0.3, d: GRID_SIZE },
        { x: half, z: 0, w: 0.3, d: GRID_SIZE }
    ];
    positions.forEach(p => {
        const geo = new THREE.BoxGeometry(p.w, 1.5, p.d);
        const wall = new THREE.Mesh(geo, wallMat);
        wall.position.set(p.x, 0.25, p.z);
        wall.receiveShadow = true;
        scene.add(wall);
    });
}

function spawnInitialObstacles() {
    obstacles.forEach(o => scene.remove(o));
    obstacles = [];
    for (let i = 0; i < 5; i++) {
        spawnObstacle();
    }
}

function spawnObstacle() {
    const geometry = new THREE.CylinderGeometry(0.4, 0.5, 2, 8);
    const material = new THREE.MeshStandardMaterial({
        color: COLORS.obstacle,
        emissive: COLORS.obstacleEmissive,
        emissiveIntensity: 1.2,
        roughness: 0.3,
        metalness: 0.4
    });
    const obstacle = new THREE.Mesh(geometry, material);
    obstacle.castShadow = true;
    obstacle.receiveShadow = true;
    let pos;
    do {
        pos = new THREE.Vector3(
            Math.floor(Math.random() * (GRID_SIZE - 2) - (GRID_SIZE / 2 - 1)),
            1,
            Math.floor(Math.random() * (GRID_SIZE - 2) - (GRID_SIZE / 2 - 1))
        );
    } while (
        snake.body.some(b => b.x === pos.x && b.z === pos.z) ||
        (food && Math.round(food.position.x) === pos.x && Math.round(food.position.z) === pos.z) ||
        obstacles.some(o => o.position.x === pos.x && o.position.z === pos.z)
    );
    obstacle.position.copy(pos);
    scene.add(obstacle);
    obstacles.push(obstacle);
}

const SWIPE_MIN_PX = 36;

function handleTouchStart(ev) {
    const tch = ev.changedTouches?.[0];
    if (!tch) return;
    touchSwipeStartX = tch.clientX;
    touchSwipeStartY = tch.clientY;
    touchSwipeTracking = true;
}

function handleTouchEnd(ev) {
    const tch = ev.changedTouches?.[0];
    if (!touchSwipeTracking || !tch) return;
    touchSwipeTracking = false;
    if (!overlayEl?.classList.contains('hidden')) return;
    if (isPaused || isGameOver) return;
    const dx = tch.clientX - touchSwipeStartX;
    const dy = tch.clientY - touchSwipeStartY;
    if (Math.abs(dx) < SWIPE_MIN_PX && Math.abs(dy) < SWIPE_MIN_PX) return;
    if (Math.abs(dx) > Math.abs(dy)) {
        if (dx > 0 && direction.x !== -1) nextDirection.set(1, 0, 0);
        else if (dx < 0 && direction.x !== 1) nextDirection.set(-1, 0, 0);
    } else {
        if (dy > 0 && direction.z !== -1) nextDirection.set(0, 0, 1);
        else if (dy < 0 && direction.z !== 1) nextDirection.set(0, 0, -1);
    }
}

function handleMouseDown(e) {
    if (isLanguageMenuOpen && e.button === 0 && pauseCtx) {
        const rect = pauseCanvas.getBoundingClientRect();
        const scaleX = pauseCanvas.width / rect.width;
        const scaleY = pauseCanvas.height / rect.height;
        const x = (e.clientX - rect.left) * scaleX;
        const y = (e.clientY - rect.top) * scaleY;
        const bw = 200;
        const bh = 50;
        const bx = (pauseCanvas.width - bw) / 2;
        const by = pauseCanvas.height / 2 + 60;
        if (x >= bx && x <= bx + bw && y >= by && y <= by + bh) {
            currentLanguage = currentLanguage === 'ru' ? 'en' : 'ru';
            syncUILayoutLanguage();
        }
        return;
    }
    if (e.button === 0 && !isGameOver && overlayEl?.classList.contains('hidden')) {
        shootLaser();
    }
}

function shootLaser() {
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(obstacles);
    const headPos = snake.meshSegments[0].position.clone();
    let targetPos;
    if (intersects.length > 0) {
        const hit = intersects[0].object;
        targetPos = hit.position.clone();
        createExplosion(hit.position);
        scene.remove(hit);
        obstacles = obstacles.filter(o => o !== hit);
        setTimeout(spawnObstacle, 2000);
    } else {
        targetPos = raycaster.ray.direction.clone().multiplyScalar(50).add(raycaster.ray.origin);
    }
    const distance = headPos.distanceTo(targetPos);
    if (isNaN(distance) || distance <= 0) return;
    const beamGeo = new THREE.CylinderGeometry(0.04, 0.04, distance, 8);
    const beamMat = new THREE.MeshBasicMaterial({ color: COLORS.laser, transparent: true, opacity: 0.9 });
    const beam = new THREE.Mesh(beamGeo, beamMat);
    const midpoint = new THREE.Vector3().addVectors(headPos, targetPos).multiplyScalar(0.5);
    beam.position.copy(midpoint);
    beam.lookAt(targetPos);
    beam.rotateX(Math.PI / 2);
    scene.add(beam);
    let opacity = 0.9;
    const fade = setInterval(() => {
        opacity -= 0.08;
        if (opacity <= 0) {
            scene.remove(beam);
            clearInterval(fade);
        } else {
            beam.material.opacity = opacity;
            beam.scale.x = opacity;
            beam.scale.z = opacity;
        }
    }, 25);
}

function createExplosion(pos) {
    const particleCount = 14;
    for (let i = 0; i < particleCount; i++) {
        const geo = new THREE.SphereGeometry(0.07, 4, 4);
        const mat = new THREE.MeshBasicMaterial({ color: COLORS.food, transparent: true, opacity: 1 });
        const particle = new THREE.Mesh(geo, mat);
        particle.position.copy(pos);
        const angle = (i / particleCount) * Math.PI * 2;
        particle.userData = {
            velocity: new THREE.Vector3(Math.cos(angle) * 0.15, Math.random() * 0.2, Math.sin(angle) * 0.15),
            life: 1.0
        };
        scene.add(particle);
        trailParticles.push(particle);
    }
}

function spawnFood() {
    if (food) scene.remove(food);
    if (foodGlow) scene.remove(foodGlow);
    const geometry = new THREE.SphereGeometry(0.35, 32, 32);
    const material = new THREE.MeshStandardMaterial({
        color: COLORS.food,
        emissive: COLORS.foodEmissive,
        emissiveIntensity: 3,
        roughness: 0.1,
        metalness: 0.1
    });
    food = new THREE.Mesh(geometry, material);
    const ringGeo = new THREE.TorusGeometry(0.45, 0.06, 16, 32);
    const ringMat = new THREE.MeshBasicMaterial({ color: COLORS.food, transparent: true, opacity: 0.6 });
    foodGlow = new THREE.Mesh(ringGeo, ringMat);
    let foodPos;
    do {
        foodPos = new THREE.Vector3(
            Math.floor(Math.random() * (GRID_SIZE - 2) - (GRID_SIZE / 2 - 1)),
            0,
            Math.floor(Math.random() * (GRID_SIZE - 2) - (GRID_SIZE / 2 - 1))
        );
    } while (
        snake.body.some(b => b.x === foodPos.x && b.z === foodPos.z) ||
        obstacles.some(o => o.position.x === foodPos.x && o.position.z === foodPos.z)
    );
    food.position.copy(foodPos);
    food.position.y = FOOD_Y;
    foodGlow.position.copy(foodPos);
    foodGlow.position.y = FOOD_Y;
    scene.add(food);
    scene.add(foodGlow);
}

function handleInput(e) {
    const key = e.code;
    const now = Date.now();
    if (key === 'Escape') {
        if (!isGameOver && overlayEl?.classList.contains('hidden')) {
            isPaused = !isPaused;
            if (isPaused) {
                pausedByEscape = true;
                gameplaySdkNotifyStop();
                isLanguageMenuOpen = true;
                pauseCanvas.style.display = 'block';
            } else {
                pausedByEscape = false;
                isLanguageMenuOpen = false;
                pauseCanvas.style.display = 'none';
                if (pauseCtx) pauseCtx.clearRect(0, 0, pauseCanvas.width, pauseCanvas.height);
                lastMoveTime = Date.now();
                gameplaySdkNotifyStart();
            }
        }
        return;
    }
    if (isPaused) return;
    if (key === 'KeyW' && direction.z !== 1) nextDirection.set(0, 0, -1);
    if (key === 'KeyS' && direction.z !== -1) nextDirection.set(0, 0, 1);
    if (key === 'KeyA' && direction.x !== 1) nextDirection.set(-1, 0, 0);
    if (key === 'KeyD' && direction.x !== -1) nextDirection.set(1, 0, 0);
    if (key === 'KeyW' || key === 'KeyA' || key === 'KeyS' || key === 'KeyD') {
        if (key === lastKeyCode && (now - lastKeyTime) < DOUBLE_PRESS_THRESHOLD && !isBoostActive) {
            boostKey = key;
            isBoostActive = true;
            currentMoveInterval = BOOST_SPEED;
            if (speedFillEl) speedFillEl.style.width = '100%';
        }
        lastKeyCode = key;
        lastKeyTime = now;
    }
}

function handleKeyUp(e) {
    const key = e.code;
    if (key === boostKey && isBoostActive) {
        boostKey = null;
        isBoostActive = false;
        currentMoveInterval = INITIAL_SPEED;
        if (speedFillEl) speedFillEl.style.width = '0%';
    }
}

function startGame() {
    accumulator = 0;
    pausedByEscape = false;
    score = 0;
    if (scoreEl) scoreEl.innerText = '000';
    isGameOver = false;
    direction.set(1, 0, 0);
    nextDirection.set(1, 0, 0);
    lastMoveTime = Date.now();
    currentMoveInterval = INITIAL_SPEED;
    isBoostActive = false;
    boostKey = null;
    lastKeyCode = null;
    lastKeyTime = 0;
    isPaused = false;
    isLanguageMenuOpen = false;
    pauseCanvas.style.display = 'none';
    if (pauseCtx) pauseCtx.clearRect(0, 0, pauseCanvas.width, pauseCanvas.height);
    if (speedFillEl) speedFillEl.style.width = '0%';
    trailParticles.forEach(p => scene.remove(p));
    trailParticles = [];
    snake.reset();
    ensureSnakeVisible();
    copySnakeBodyToPrevBody();
    spawnFood();
    spawnInitialObstacles();
    if (overlayEl) overlayEl.classList.add('hidden');
    gameplaySdkNotifyStart();
}

function gameOver() {
    gameplaySdkNotifyStop();
    isGameOver = true;
    if (overlayEl) {
        overlayEl.classList.remove('hidden');
        if (startScreen) startScreen.classList.add('hidden');
        if (gameOverScreen) gameOverScreen.classList.remove('hidden');
    }
    if (finalScoreEl) finalScoreEl.innerText = score;
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
    if (pauseCanvas) {
        pauseCanvas.width = window.innerWidth;
        pauseCanvas.height = window.innerHeight;
    }
}

function moveSnake() {
    direction.copy(nextDirection);
    const head = snake.body[0].clone().add(direction);
    head.y = SNAKE_Y;
    const hitObstacle = obstacles.some(o => Math.round(o.position.x) === head.x && Math.round(o.position.z) === head.z);
    if (snake.checkCollision(head) || hitObstacle) {
        gameOver();
        return;
    }
    if (head.x === Math.round(food.position.x) && head.z === Math.round(food.position.z)) {
        score += 10;
        if (scoreEl) scoreEl.innerText = score.toString().padStart(3, '0');
        snake.grow(head);
        spawnFood();
    } else {
        snake.update(head);
    }
}

function handleVisibilityChange() {
    const inGameplay = overlayEl?.classList.contains('hidden') && !isGameOver;
    if (document.hidden) {
        if (inGameplay && !pausedByEscape) {
            gameplaySdkNotifyStop();
        }
        if (inGameplay && !pausedByEscape) isPaused = true;
    } else {
        lastMoveTime = Date.now();
        if (!inGameplay || pausedByEscape) return;
        isPaused = false;
        gameplaySdkNotifyStart();
    }
}

function showFullscreenAd() {
    if (!ysdk) return;
    ysdk.adv.showFullscreenAdv({
        callbacks: {
            onOpen: () => {
                gameplaySdkNotifyStop();
                isPaused = true;
            },
            onClose: () => {
                lastMoveTime = Date.now();
                const canGameplay = overlayEl?.classList.contains('hidden') && !isGameOver && !pausedByEscape;
                if (!pausedByEscape) isPaused = false;
                if (canGameplay) gameplaySdkNotifyStart();
            },
            onError: () => {}
        }
    });
}

function showRewardedAd() {
    if (!ysdk) return;
    ysdk.adv.showRewardedVideo({
        callbacks: {
            onOpen: () => {
                gameplaySdkNotifyStop();
                isPaused = true;
            },
            onRewarded: () => {},
            onClose: () => {
                lastMoveTime = Date.now();
                const canGameplay = overlayEl?.classList.contains('hidden') && !isGameOver && !pausedByEscape;
                if (!pausedByEscape) isPaused = false;
                if (canGameplay) gameplaySdkNotifyStart();
            },
            onError: () => {}
        }
    });
}

function initYandexGames() {
    if (typeof YaGames === 'undefined') {
        gameplaySdkAvailable = false;
        return;
    }
    YaGames.init({
        adv: {
            onAdvClose: () => {
                lastMoveTime = Date.now();
            }
        }
    })
        .then((ysdkInstance) => {
            ysdk = ysdkInstance;
            gameplaySdkAvailable = !!(
                ysdk.features?.GameplayAPI &&
                typeof ysdk.features.GameplayAPI.start === 'function' &&
                typeof ysdk.features.GameplayAPI.stop === 'function'
            );
            try {
                const langRaw = ysdk.environment?.i18n?.lang;
                currentLanguage = deriveLanguageFromSdkCode(langRaw);
                syncUILayoutLanguage();
            } catch (_) {}
            sdkSendLoadingReady();
            ysdk
                .getPlayer()
                .then((_player) => {
                    player = _player;
                    if (!player?.setData) return;
                    Promise.resolve(player.setData({ visited: true })).catch(() => {});
                })
                .catch(() => {});
        })
        .catch(() => {
            gameplaySdkAvailable = false;
            ysdk = null;
        });
}

function drawPauseMenu() {
    if (!isLanguageMenuOpen || !pauseCtx) return;
    const w = pauseCanvas.width;
    const h = pauseCanvas.height;
    pauseCtx.clearRect(0, 0, w, h);
    pauseCtx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    pauseCtx.fillRect(0, 0, w, h);
    pauseCtx.textAlign = 'center';
    pauseCtx.textBaseline = 'middle';
    pauseCtx.fillStyle = '#ffffff';
    pauseCtx.font = 'bold 32px Arial';
    pauseCtx.fillText(t('pause'), w / 2, h / 2 - 80);
    pauseCtx.font = '16px Arial';
    pauseCtx.fillText(t('language'), w / 2, h / 2 + 20);
    const bw = 200;
    const bh = 50;
    const bx = (w - bw) / 2;
    const by = h / 2 + 60;
    pauseCtx.fillStyle = '#444444';
    pauseCtx.fillRect(bx, by, bw, bh);
    pauseCtx.fillStyle = '#ffffff';
    pauseCtx.font = '18px Arial';
    pauseCtx.fillText(
        currentLanguage === 'ru' ? txt('pauseLangEnglish') : txt('pauseLangRussian'),
        w / 2,
        by + bh / 2
    );
}

let lastFrameTime = 0;
let accumulator = 0;

function isGameplayActive() {
    return !isGameOver && overlayEl && overlayEl.classList.contains('hidden') && !isPaused;
}

function animate(currentTime) {
    requestAnimationFrame(animate);
    if (!lastFrameTime) lastFrameTime = currentTime;
    let deltaTime = (currentTime - lastFrameTime) / 1000;
    lastFrameTime = currentTime;
    deltaTime = Math.min(deltaTime, 0.1);
    if (isGameplayActive()) {
        accumulator += deltaTime;
        ensureSnakeVisible();
        let movesThisFrame = 0;
        while (accumulator >= currentMoveInterval && movesThisFrame < MAX_GRID_MOVES_PER_FRAME) {
            copySnakeBodyToPrevBody();
            lastMoveTime = Date.now();
            moveSnake();
            accumulator -= currentMoveInterval;
            movesThisFrame++;
        }
        const alpha = accumulator / currentMoveInterval;
        for (let i = 0; i < snake.body.length; i++) {
            if (snake.meshSegments[i] && i < prevBody.length) {
                const target = snake.body[i];
                const prev = prevBody[i] || target;
                snake.meshSegments[i].position.lerpVectors(prev, target, alpha);
                if (i === 0) {
                    tmpHeadLook.copy(snake.meshSegments[i].position).add(direction);
                    snake.meshSegments[i].lookAt(tmpHeadLook);
                }
                const scaleBase = i === 0 ? 0.9 : 0.8;
                snake.meshSegments[i].scale.setScalar(scaleBase);
            }
        }
        camera.position.set(0, 15, 13);
        camera.lookAt(0, 0, 0);
    } else {
        accumulator = 0;
        if (snake && snake.meshSegments.length && snake.body.length) {
            ensureSnakeVisible();
            for (let i = 0; i < snake.body.length; i++) {
                if (snake.meshSegments[i]) {
                    snake.meshSegments[i].position.copy(snake.body[i]);
                    if (i === 0) {
                        tmpHeadLook.copy(snake.meshSegments[i].position).add(direction);
                        snake.meshSegments[i].lookAt(tmpHeadLook);
                    }
                }
            }
        }
        if (camera) {
            camera.position.set(0, 15, 13);
            camera.lookAt(0, 0, 0);
        }
    }
    if (food) {
        food.position.y = FOOD_Y;
        food.rotation.y += 0.012;
        if (foodGlow) {
            foodGlow.position.x = food.position.x;
            foodGlow.position.y = FOOD_Y;
            foodGlow.position.z = food.position.z;
            foodGlow.rotation.y += 0.01;
            foodGlow.scale.setScalar(1);
        }
    }
    obstacles.forEach(o => {
        o.rotation.y += 0.004;
        o.position.y = 1;
    });
    for (let i = trailParticles.length - 1; i >= 0; i--) {
        const p = trailParticles[i];
        p.userData.life -= 0.03;
        p.position.add(p.userData.velocity);
        p.userData.velocity.y += 0.002;
        p.material.opacity = p.userData.life;
        p.scale.setScalar(p.userData.life);
        if (p.userData.life <= 0) {
            scene.remove(p);
            trailParticles.splice(i, 1);
        }
    }
    if (composer) composer.render();
    drawPauseMenu();
}

init();

window.showFullscreenAd = showFullscreenAd;
window.showRewardedAd = showRewardedAd;
