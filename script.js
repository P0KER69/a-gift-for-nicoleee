"use strict";

/* =========================================================
   REDUCED MOTION
   (Governs visual motion only — sound is a separate decision,
   handled entirely through the sound toggle.)
========================================================= */

const prefersReducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
).matches;


/* =========================================================
   SOUND ENGINE

   Every sound below is synthesized live with the Web Audio
   API — oscillators, noise, and filters. Nothing is loaded
   from a file, so there's nothing that can go missing or
   need licensing. If you'd rather use a real music file,
   see the comment above SoundEngine.startMusic().

   Volumes are deliberately kept soft. If it's too quiet or
   too loud for your taste, the numbers to tweak are marked
   "VOLUME" below.
========================================================= */

const SoundEngine = (() => {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    const supported = !!AudioContextClass;

    let ctx = null;
    let master = null;
    let sfxGain = null;
    let musicGain = null;
    let muted = false;
    let musicStarted = false;

    function ensureContext() {
        if (!supported || ctx) return;

        ctx = new AudioContextClass();

        master = ctx.createGain();
        master.gain.value = 1;
        master.connect(ctx.destination);

        sfxGain = ctx.createGain();
        sfxGain.gain.value = 0.32; // VOLUME: sound effects
        sfxGain.connect(master);

        musicGain = ctx.createGain();
        musicGain.gain.value = 0;
        musicGain.connect(master);
    }

    // Must be called synchronously inside a real click/keydown handler —
    // iOS and Chrome both require a genuine user gesture before audio
    // is allowed to play at all.
    function unlock() {
        if (!supported) return;
        ensureContext();
        if (ctx.state === "suspended") {
            ctx.resume();
        }
    }

    function setMuted(value) {
        muted = value;
        if (!ctx) return;
        const target = muted ? 0 : 1;
        master.gain.cancelScheduledValues(ctx.currentTime);
        master.gain.linearRampToValueAtTime(target, ctx.currentTime + 0.2);
    }

    function isMuted() {
        return muted;
    }

    // ---- one-off effects -------------------------------------------

    function tone({ freq = 440, duration = 0.12, type = "sine", gain = 0.5, glideTo = null } = {}) {
        if (!ctx) return;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();

        osc.type = type;
        osc.frequency.setValueAtTime(freq, ctx.currentTime);
        if (glideTo) {
            osc.frequency.exponentialRampToValueAtTime(glideTo, ctx.currentTime + duration);
        }

        g.gain.setValueAtTime(0.0001, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(gain, ctx.currentTime + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);

        osc.connect(g);
        g.connect(sfxGain);
        osc.start();
        osc.stop(ctx.currentTime + duration + 0.02);
    }

    function click() {
        tone({ freq: 480, glideTo: 340, duration: 0.09, type: "triangle", gain: 0.3 });
    }

    function whoosh() {
        if (!ctx) return;
        const length = Math.floor(ctx.sampleRate * 0.4);
        const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < length; i++) {
            data[i] = (Math.random() * 2 - 1) * (1 - i / length);
        }

        const noise = ctx.createBufferSource();
        noise.buffer = buffer;

        const filter = ctx.createBiquadFilter();
        filter.type = "bandpass";
        filter.frequency.setValueAtTime(300, ctx.currentTime);
        filter.frequency.exponentialRampToValueAtTime(1800, ctx.currentTime + 0.35);
        filter.Q.value = 0.8;

        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.22, ctx.currentTime + 0.05); // VOLUME: transitions
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);

        noise.connect(filter);
        filter.connect(g);
        g.connect(sfxGain);
        noise.start();
    }

    function chimeOpen() {
        [523.25, 659.25, 783.99].forEach((freq, i) => {
            setTimeout(() => tone({ freq, duration: 0.5, type: "sine", gain: 0.22 }), i * 90);
        });
    }

    function chimeClose() {
        tone({ freq: 420, glideTo: 260, duration: 0.18, type: "sine", gain: 0.22 });
    }

    function reveal() {
        tone({ freq: 600, duration: 0.15, type: "sine", gain: 0.2 });
        setTimeout(() => tone({ freq: 900, duration: 0.25, type: "sine", gain: 0.18 }), 90);
    }

    function sparkle() {
        const freq = 1400 + Math.random() * 900;
        tone({ freq, glideTo: freq * 1.6, duration: 0.35, type: "sine", gain: 0.16 });
    }

    function tick() {
        tone({ freq: 1000, duration: 0.03, type: "square", gain: 0.05 });
    }

    function success() {
        [659.25, 987.77].forEach((freq, i) => {
            setTimeout(() => tone({ freq, duration: 0.4, type: "triangle", gain: 0.2 }), i * 120);
        });
    }

    function fanfare() {
        [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
            setTimeout(() => tone({ freq, duration: 0.6, type: "triangle", gain: 0.22 }), i * 110);
        });
    }

    function clap() {
        const bursts = [
            { freq: 1600, gain: 0.18, duration: 0.08 },
            { freq: 2200, gain: 0.14, duration: 0.06 },
            { freq: 1800, gain: 0.2, duration: 0.08 },
            { freq: 1500, gain: 0.18, duration: 0.06 }
        ];

        bursts.forEach((burst, i) => {
            setTimeout(() => {
                tone({
                    freq: burst.freq,
                    duration: burst.duration,
                    type: "square",
                    gain: burst.gain,
                    glideTo: burst.freq * 0.82
                });
            }, i * 70);
        });
    }

    // ---- background music (real audio file) --------------------------
    //
    // Plays the track in /audio on a loop, routed through the same
    // gain graph as every other sound here (via createMediaElement-
    // Source), so the one sound toggle still mutes music and effects
    // together — nothing extra needed for that to keep working.
    //
    // WANT A DIFFERENT SONG LATER?
    // Just replace audio/background-music.mp3 with another file of
    // the same name — nothing else needs to change. To adjust how
    // loud it sits, tweak the number marked "VOLUME" below.

    let musicElement = null;

    function startMusic() {
        if (!ctx || musicStarted) return;
        musicStarted = true;

        musicElement = new Audio("audio/background-music.mp3");
        musicElement.loop = true;
        musicElement.preload = "auto";

        const source = ctx.createMediaElementSource(musicElement);
        source.connect(musicGain);

        musicGain.gain.cancelScheduledValues(ctx.currentTime);
        musicGain.gain.linearRampToValueAtTime(0.55, ctx.currentTime + 2.5); // VOLUME: overall music

        const playPromise = musicElement.play();
        if (playPromise && playPromise.catch) {
            playPromise.catch(() => {
                /* Autoplay blocked — shouldn't happen since this only
                   ever runs from a real tap/keypress, but if it does,
                   the next interaction will simply try again. */
            });
        }
    }

    return {
        supported,
        unlock,
        setMuted,
        isMuted,
        click,
        whoosh,
        chimeOpen,
        chimeClose,
        reveal,
        sparkle,
        tick,
        success,
        fanfare,
        clap,
        startMusic
    };
})();


/* =========================================================
   FIRST INTERACTION UNLOCKS AUDIO

   Runs once, on whatever the very first tap/click/key press
   anywhere on the page turns out to be — not just the opening
   gate — so audio still works even if someone jumps straight
   to a section dot.
========================================================= */

function primeAudio() {
    SoundEngine.unlock();
    SoundEngine.startMusic();
    requestOrientationPermission();
}

document.addEventListener("pointerdown", primeAudio, { once: true });
document.addEventListener("keydown", primeAudio, { once: true });


/* =========================================================
   MOBILE TILT PARALLAX (device orientation)

   A small depth effect for phones: the two background glows
   drift gently opposite the direction you tilt the phone —
   the same layered-parallax feel sites like apple.com use on
   product pages, just driven by the motion sensor instead of
   scroll. Desktop browsers don't report orientation, so this
   is effectively mobile-only without any extra checks needed.

   iOS 13+ requires asking permission for motion data, and that
   ask has to happen inside a real user gesture — the very first
   tap already unlocks audio (see primeAudio above), so it does
   triple duty here too. Android and older iOS skip the prompt
   entirely and just start.
========================================================= */

const orb1 = document.querySelector(".orb-1");
const orb2 = document.querySelector(".orb-2");

let orientationActive = false;
let targetTiltX = 0;
let targetTiltY = 0;
let tiltX = 0;
let tiltY = 0;

function handleOrientation(event) {
    if (event.beta === null || event.gamma === null) return;

    // Clamped to a comfortable range so an extreme tilt doesn't
    // send the orbs flying off-screen — most people glance at a
    // phone within a fairly narrow tilt range anyway.
    targetTiltX = Math.max(-30, Math.min(30, event.gamma));
    targetTiltY = Math.max(-30, Math.min(30, event.beta - 45));
}

function animateParallax() {
    // Same easing approach as the desktop cursor glow below —
    // smooths out raw sensor jitter instead of snapping directly
    // to each reading.
    tiltX += (targetTiltX - tiltX) * 0.08;
    tiltY += (targetTiltY - tiltY) * 0.08;

    if (orb1) orb1.style.transform = `translate(${tiltX * 0.6}px, ${tiltY * 0.6}px)`;
    if (orb2) orb2.style.transform = `translate(${tiltX * -0.8}px, ${tiltY * -0.8}px)`;

    requestAnimationFrame(animateParallax);
}

function enableOrientationParallax() {
    if (orientationActive || prefersReducedMotion || !window.DeviceOrientationEvent) return;
    orientationActive = true;
    window.addEventListener("deviceorientation", handleOrientation);
    requestAnimationFrame(animateParallax);
}

function requestOrientationPermission() {
    if (
        typeof DeviceOrientationEvent !== "undefined" &&
        typeof DeviceOrientationEvent.requestPermission === "function"
    ) {
        DeviceOrientationEvent.requestPermission()
            .then(response => {
                if (response === "granted") enableOrientationParallax();
            })
            .catch(() => {
                /* Prompt dismissed or blocked — the site works fine
                   without this, it's a bonus effect either way. */
            });
    } else {
        enableOrientationParallax();
    }
}


/* =========================================================
   SOUND TOGGLE
========================================================= */

const soundToggle = document.getElementById("sound-toggle");

if (soundToggle) {
    if (!SoundEngine.supported) {
        soundToggle.hidden = true;
    } else {
        soundToggle.addEventListener("click", () => {
            const nowMuted = !SoundEngine.isMuted();
            SoundEngine.setMuted(nowMuted);
            soundToggle.setAttribute("aria-pressed", String(!nowMuted));
        });
    }
}


/* =========================================================
   CONFIGURATION
========================================================= */

const scenes = [
    "opening",
    "landing",
    "intro",
    "archive",
    "machine",
    "stars",
    "gallery",
    "ending"
];

let currentScene = "opening";


/* =========================================================
   LOADER
========================================================= */

window.addEventListener("load", () => {
    const loader = document.getElementById("loader");
    const progress = document.getElementById("loader-progress");
    const number = document.getElementById("loader-number");

    if (!loader || !progress || !number) return;

    if (prefersReducedMotion) {
        loader.classList.add("hidden");
        return;
    }

    let value = 0;
    const interval = setInterval(() => {
        value += Math.floor(Math.random() * 8 + 4);

        if (value >= 100) {
            value = 100;
            clearInterval(interval);
            setTimeout(() => {
                loader.classList.add("hidden");
            }, 700);
        }

        progress.style.width = `${value}%`;
        number.textContent = value;
    }, 100);
});


/* =========================================================
   PAGE NAVIGATION
========================================================= */

function goToScene(id) {
    if (!scenes.includes(id) || id === currentScene) return;

    const current = document.getElementById(currentScene);
    const next = document.getElementById(id);
    if (!current || !next) return;

    current.classList.remove("active");
    next.classList.add("active");
    currentScene = id;
    updateDots(id);

    SoundEngine.whoosh();

    // One-time staggered reveal for sections that use it. The class
    // lives on the inner content wrapper, not the <section> itself,
    // since that's what the animation CSS actually targets.
    if (id === "ending" || id === "gallery") {
        const animTarget = next.querySelector(".ending-content, .gallery-container");
        if (animTarget) animTarget.classList.add("active-animation");
    }
}

document.querySelectorAll("[data-next]").forEach(button => {
    button.addEventListener("click", () => {
        goToScene(button.dataset.next);
    });
});

document.querySelectorAll(".dot").forEach(dot => {
    dot.addEventListener("click", () => {
        goToScene(dot.dataset.target);
    });
});

function updateDots(id) {
    document.querySelectorAll(".dot").forEach(dot => {
        dot.classList.toggle("active", dot.dataset.target === id);
    });
}

// A soft click/tick on every primary and secondary button press —
// separate from whichever transition or reveal sound also fires.
document.querySelectorAll(".main-button, .text-button, .dot").forEach(el => {
    el.addEventListener("click", () => SoundEngine.click());
});


/* =========================================================
   OPENING GATE
========================================================= */

const openingTrigger = document.getElementById("opening-trigger");

if (openingTrigger) {
    openingTrigger.addEventListener(
        "click",
        () => {
            SoundEngine.chimeOpen();
            goToScene("landing");
        },
        { once: true }
    );
}


/* =========================================================
   CURSOR GLOW
========================================================= */

const glow = document.querySelector(".cursor-glow");

if (glow && !prefersReducedMotion) {
    let mouseX = 0;
    let mouseY = 0;
    let glowX = 0;
    let glowY = 0;

    window.addEventListener("mousemove", event => {
        mouseX = event.clientX;
        mouseY = event.clientY;
    });

    // Touch screens don't fire mousemove, so the same soft glow that
    // trails a desktop cursor instead appears under a finger while
    // it's touching the screen, then fades — see the ".cursor-glow"
    // rules inside "@media (hover: none)" in styles.css.
    function handleTouch(event) {
        const touch = event.touches[0];
        if (!touch) return;

        mouseX = touch.clientX;
        mouseY = touch.clientY;

        if (!glow.classList.contains("touch-active")) {
            // Jump straight there on the first touch of a gesture
            // instead of visibly sweeping in from the last spot.
            glowX = mouseX;
            glowY = mouseY;
        }

        glow.classList.add("touch-active");
    }

    window.addEventListener("touchstart", handleTouch, { passive: true });
    window.addEventListener("touchmove", handleTouch, { passive: true });
    window.addEventListener("touchend", () => glow.classList.remove("touch-active"));
    window.addEventListener("touchcancel", () => glow.classList.remove("touch-active"));

    function animateGlow() {
        glowX += (mouseX - glowX) * 0.08;
        glowY += (mouseY - glowY) * 0.08;
        glow.style.left = `${glowX}px`;
        glow.style.top = `${glowY}px`;
        requestAnimationFrame(animateGlow);
    }

    animateGlow();
}


/* =========================================================
   PARTICLES
========================================================= */

function createParticles() {
    const container = document.getElementById("particles");
    if (!container || prefersReducedMotion) return;

    const fragment = document.createDocumentFragment();

    for (let i = 0; i < 65; i++) {
        const particle = document.createElement("div");
        particle.classList.add("particle");
        particle.style.left = `${Math.random() * 100}%`;
        particle.style.animationDuration = `${12 + Math.random() * 15}s`;
        particle.style.animationDelay = `${Math.random() * 12}s`;
        particle.style.setProperty("--drift", `${-120 + Math.random() * 240}px`);
        fragment.appendChild(particle);
    }

    container.appendChild(fragment);
}

createParticles();

async function preloadGalleryImages() {
    const images = document.querySelectorAll('.frame img[data-src]');

    for (const img of images) {
        const url = img.dataset.src;
        if (!url) continue;

        try {
            const response = await fetch(url, { method: 'HEAD' });
            if (!response.ok) {
                img.closest('.frame')?.classList.add('placeholder');
                continue;
            }

            img.src = url;
        } catch (error) {
            img.closest('.frame')?.classList.add('placeholder');
        }
    }
}

preloadGalleryImages();

/* =========================================================
   MAGNETIC BUTTONS
========================================================= */

if (!prefersReducedMotion) {
    document.querySelectorAll(".main-button, .text-button").forEach(button => {
        button.addEventListener("mousemove", event => {
            const rect = button.getBoundingClientRect();
            const x = event.clientX - rect.left - rect.width / 2;
            const y = event.clientY - rect.top - rect.height / 2;
            button.style.transform = `translate(${x * 0.18}px, ${y * 0.18}px)`;
        });

        button.addEventListener("mouseleave", () => {
            button.style.transform = "translate(0,0)";
        });
    });
}


/* =========================================================
   3D TILT (memory cards + photo frames)
========================================================= */

if (!prefersReducedMotion) {
    document.querySelectorAll(".tilt-card").forEach(card => {
        card.addEventListener("mousemove", event => {
            const rect = card.getBoundingClientRect();
            const x = event.clientX - rect.left;
            const y = event.clientY - rect.top;
            const centerX = rect.width / 2;
            const centerY = rect.height / 2;
            const rotateX = ((y - centerY) / centerY) * -4;
            const rotateY = ((x - centerX) / centerX) * 4;

            card.style.transform = `
                rotate(var(--base-rot, 0deg))
                perspective(800px)
                rotateX(${rotateX}deg)
                rotateY(${rotateY}deg)
                translateY(-4px)
            `;

            card.style.setProperty("--mx", `${(x / rect.width) * 100}%`);
            card.style.setProperty("--my", `${(y / rect.height) * 100}%`);
        });

        card.addEventListener("mouseleave", () => {
            card.style.transform = `
                rotate(var(--base-rot, 0deg))
                perspective(800px)
                rotateX(0deg)
                rotateY(0deg)
                translateY(0)
            `;
        });
    });
}


/* =========================================================
   PHOTO FLIP CARDS

   Tapping/clicking a photo turns it over to show the
   description written in its .frame-back panel. Works with
   both mouse and keyboard (Enter/Space). Placeholder frames
   (no photo added yet) don't flip — there's nothing on the
   back worth showing yet.
========================================================= */

document.querySelectorAll(".frame").forEach(frame => {
    function toggleFlip() {
        if (frame.classList.contains("placeholder")) return;

        const flipped = frame.classList.toggle("flipped");
        frame.setAttribute("aria-pressed", String(flipped));
        SoundEngine.click();
    }

    frame.addEventListener("click", toggleFlip);

    frame.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            toggleFlip();
        }
    });
});


/* =========================================================
   MEMORY CONTENT

   IMPORTANT:
   This is where your personal writing goes. Don't use generic
   compliments — think of each entry as:

       WHAT HAPPENED?
       WHAT DID I NOTICE?
       WHY DID IT STAY WITH ME?

   2–5 sentences each, in your own natural wording.
========================================================= */

const memories = [
    {
        number: "01 / THE LITTLE THINGS",
        title: "YOUR WEIRDNESS",
        text: "I never want you to change your stupid weirdness, every time you make me laugh it makes me look forward to the next, you're too funny later i mati."
    },
    {
        number: "02 / A MEMORY",
        title: "STUDY ROOMS",
        text: "I loved going to study rooms with you. When we walked back, talked about people and especially your funny face with that girl, it was all such a fun experience I can never forget. This really made me have the best semester I never thought I would have, especially deciding what drink you might like HAHAHAHA."
    },
    {
        number: "03 / THANK YOU",
        title: "YOU MADE ME A BETTER PERSON",
        text: "Perhaps it hasn't been a lot of time since we've known each other, but you taught me a lot of things. I thank you so much for that and all of it was so useful. You made me realize things that made me grow. Thank you."
    },
    {
        number: "04 / SOMETHING I WANT YOU TO REMEMBER",
        title: "STAY KIND WITH ME",
        text: "I'll push you to become the best version of yourself, Nicole. Please always stay kind, stay blessed and love every part of your life, I want to motivate you in every way I can during my time in Uni and improve both of us."
    }
];


/* =========================================================
   MEMORY MODAL
========================================================= */

const memoryModal = document.getElementById("memory-modal");
const memoryNumberEl = document.getElementById("memory-number");
const memoryTitleEl = document.getElementById("memory-title");
const memoryTextEl = document.getElementById("memory-text");
const closeButton = document.querySelector(".close-button");

let lastFocusedElement = null;

document.querySelectorAll(".memory-card").forEach((card, index) => {
    card.addEventListener("click", () => {
        openMemory(memories[index], card);
    });
});

function openMemory(memory, triggerEl) {
    if (!memoryModal) return;

    lastFocusedElement = triggerEl || document.activeElement;

    memoryNumberEl.textContent = memory.number;
    memoryTitleEl.textContent = memory.title;
    memoryTextEl.textContent = memory.text;

    memoryModal.hidden = false;
    requestAnimationFrame(() => memoryModal.classList.add("active"));

    SoundEngine.reveal();
    closeButton.focus();
}

function closeMemory() {
    if (!memoryModal || !memoryModal.classList.contains("active")) return;

    memoryModal.classList.remove("active");
    SoundEngine.chimeClose();

    setTimeout(() => {
        memoryModal.hidden = true;
    }, 500);

    if (lastFocusedElement) {
        lastFocusedElement.focus();
    }
}

if (closeButton) {
    closeButton.addEventListener("click", closeMemory);
}

if (memoryModal) {
    // Only close when the click lands on the dark overlay itself,
    // not when it bubbles up from inside the modal content.
    memoryModal.addEventListener("click", event => {
        if (event.target === memoryModal) {
            closeMemory();
        }
    });
}

document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
        closeMemory();
    }
});


/* =========================================================
   MACHINE
========================================================= */

const machineSteps = [
    "INITIALIZING SYSTEM...",
    "CONNECTING TO DATABASE...",
    "COLLECTING RELEVANT DATA...",
    "FILTERING IRRELEVANT INFORMATION...",
    "ANALYZING CONVERSATIONS...",
    "MEASURING SMILE POTENTIAL...",
    "RECALCULATING...",
    "CHECKING RESULTS...",
    "RESULTS LOOK SUSPICIOUS...",
    "RUNNING AGAIN...",
    "PLEASE IGNORE THE LACK OF SCIENTIFIC VALIDITY..."
];

const runButton = document.getElementById("run-button");
const machineOutput = document.getElementById("machine-output");
const machineText = document.getElementById("machine-text");
const progressBar = document.getElementById("progress-bar");

let machineState = "idle"; // "idle" | "running" | "done"

if (runButton) {
    runButton.addEventListener("click", () => {
        if (machineState === "idle") {
            runMachine();
        } else if (machineState === "done") {
            goToScene("stars");
        }
    });
}

async function runMachine() {
    machineState = "running";
    runButton.disabled = true;
    runButton.innerHTML = "<span>processing...</span><span>◌</span>";
    machineOutput.classList.add("visible");

    const stepDelay = prefersReducedMotion ? 80 : 700;

    for (let i = 0; i < machineSteps.length; i++) {
        machineText.textContent = machineSteps[i];
        const progress = Math.round(((i + 1) / machineSteps.length) * 100);
        progressBar.style.width = `${progress}%`;
        SoundEngine.tick();
        await wait(stepDelay);
    }

    await wait(prefersReducedMotion ? 80 : 500);

    /*
        OPTIONAL:
        You can make the result reference something personal between
        you two. Keep it playful, not overly romantic.
    */
    machineText.innerHTML = `
        ANALYSIS COMPLETE
        <br><br>
        FINAL RESULT:
        <br>
        ████████████████████
        <br><br>
        The machine has said:
        naaaa boleh laa u can continue to the next part of the website
    `;

    SoundEngine.success();
    runButton.disabled = false;
    runButton.innerHTML = "<span>continue</span><span>→</span>";
    machineState = "done";
}

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


/* =========================================================
   STAR FIELD

   IMPORTANT:
   Replace each placeholder below with your own tiny message.
   Mix memories, observations, inside jokes, tiny appreciations,
   something funny, and one or two sentimental ones. Keep each
   one short — the count in the HTML (x / 9) should match the
   number of messages below.
========================================================= */

const starMessages = [
    "First letter of dog in malay ;)",
    "Starts with somethings you love to say when I dono something",
    "The letter of the most prominent sound in the way you say variety",
    "First letter of my favourite country",
    "First letter of my superhero name",
    "First letter of the thing you value a lot in relationships",
    "First letter of your favourite country",
    "First letter of my favourite sushi roll",
    "Here's a free one, at the end there's U."
];

const STAR_PASSWORD = "autisticu";

let starsFound = 0;

function triggerStarPasswordSuccess() {
    const flash = document.createElement("div");
    flash.className = "star-flash error";
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 460);

    const overlay = document.createElement("div");
    overlay.className = "clap-overlay";
    overlay.textContent = "* CLAP * CLAP *";
    document.body.appendChild(overlay);
    setTimeout(() => overlay.remove(), 1200);

    SoundEngine.clap();
    SoundEngine.fanfare();

    const message = document.getElementById("star-password-message");
    if (message) {
        message.textContent = "access granted";
        message.classList.remove("error");
        message.classList.add("success");
    }
}

function triggerStarPasswordError() {
    const flash = document.createElement("div");
    flash.className = "star-flash error";
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 460);

    const message = document.getElementById("star-password-message");
    if (message) {
        message.textContent = "try again";
        message.classList.remove("success");
        message.classList.add("error");
    }
}

const starPasswordInput = document.getElementById("star-password-input");
const starPasswordSubmit = document.getElementById("star-password-submit");

if (starPasswordSubmit && starPasswordInput) {
    const checkPassword = () => {
        const value = starPasswordInput.value.trim().toLowerCase();

        if (value === STAR_PASSWORD) {
            triggerStarPasswordSuccess();
            starPasswordInput.value = "";
            return;
        }

        triggerStarPasswordError();
        starPasswordInput.value = "";
        starPasswordInput.focus();
    };

    starPasswordSubmit.addEventListener("click", checkPassword);
    starPasswordInput.addEventListener("keydown", event => {
        if (event.key === "Enter") {
            event.preventDefault();
            checkPassword();
        }
    });
}

function createStars() {
    const field = document.getElementById("star-field");
    if (!field) return;

    const totalStars = 44;
    const fragment = document.createDocumentFragment();

    for (let i = 0; i < totalStars; i++) {
        const star = document.createElement("button");
        star.type = "button";
        star.className = "star";
        star.setAttribute("aria-label", "A star to find");
        star.style.left = `${Math.random() * 100}%`;
        star.style.top = `${Math.random() * 100}%`;
        star.style.setProperty("--size", `${1 + Math.random() * 2.8}px`);
        star.style.setProperty("--duration", `${2 + Math.random() * 4}s`);
        star.style.animationDelay = `${Math.random() * 4}s`;
        star.dataset.index = i % starMessages.length;

        star.addEventListener("click", event => {
            revealStar(star, event);
        });

        fragment.appendChild(star);
    }

    field.appendChild(fragment);
}

createStars();

function revealStar(star, event) {
    if (star.classList.contains("found")) return;

    star.classList.add("found");
    starsFound++;
    SoundEngine.sparkle();

    const countEl = document.getElementById("star-count");
    if (countEl) {
        countEl.textContent = Math.min(starsFound, starMessages.length);
    }

    const message = document.createElement("div");
    message.className = "star-message";
    message.textContent = starMessages[Number(star.dataset.index)];

    // Placed off-screen first so its real rendered size can be
    // measured — the old version guessed a fixed 280x150 box for
    // every message, but message height actually varies with text
    // length, and that guess was often wrong on narrow phones
    // (hence messages running off the edge in portrait).
    message.style.left = "-9999px";
    message.style.top = "-9999px";
    document.body.appendChild(message);

    const rect = message.getBoundingClientRect();

    // visualViewport reflects the actually-visible area on mobile
    // browsers (accounting for on-screen keyboards, etc.) more
    // reliably than innerWidth/innerHeight.
    const viewportWidth = window.visualViewport ? window.visualViewport.width : window.innerWidth;
    const viewportHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    const margin = 12;

    // A keyboard-triggered click (Enter/Space on a focused star)
    // reports clientX/Y as 0 in most browsers — event.detail is 0
    // for those synthetic clicks, so fall back to the star's own
    // position instead of anchoring the message at the corner.
    const isKeyboardActivation = event.detail === 0;
    const anchor = isKeyboardActivation ? star.getBoundingClientRect() : null;

    let x = (anchor ? anchor.left + anchor.width / 2 : event.clientX) + 15;
    let y = (anchor ? anchor.top + anchor.height / 2 : event.clientY) + 15;

    x = Math.max(margin, Math.min(x, viewportWidth - rect.width - margin));
    y = Math.max(margin, Math.min(y, viewportHeight - rect.height - margin));

    message.style.left = `${x}px`;
    message.style.top = `${y}px`;

    requestAnimationFrame(() => message.classList.add("visible"));

    setTimeout(() => {
        message.classList.remove("visible");
        setTimeout(() => message.remove(), 400);
    }, 3000);
}

const starContinue = document.getElementById("star-continue");
if (starContinue) {
    starContinue.addEventListener("click", () => {
        goToScene("gallery");
    });
}


/* =========================================================
   OPTIONAL: click-anywhere particle burst
========================================================= */

if (!prefersReducedMotion) {
    document.addEventListener("click", event => {
        if (
            event.target.closest("button") ||
            event.target.closest(".memory-card") ||
            event.target.closest(".star")
        ) {
            return;
        }
        createClickBurst(event.clientX, event.clientY);
    });
}

function createClickBurst(x, y) {
    const burstSize = 8;

    for (let i = 0; i < burstSize; i++) {
        const particle = document.createElement("div");
        particle.style.position = "fixed";
        particle.style.left = `${x}px`;
        particle.style.top = `${y}px`;
        particle.style.width = "2px";
        particle.style.height = "2px";
        particle.style.borderRadius = "50%";
        particle.style.background = "white";
        particle.style.pointerEvents = "none";
        particle.style.zIndex = "800";
        document.body.appendChild(particle);

        const angle = (Math.PI * 2 / burstSize) * i;
        const distance = 25 + Math.random() * 35;

        particle.animate(
            [
                { transform: "translate(0,0)", opacity: 0.8 },
                {
                    transform: `translate(${Math.cos(angle) * distance}px, ${Math.sin(angle) * distance}px)`,
                    opacity: 0
                }
            ],
            {
                duration: 500 + Math.random() * 300,
                easing: "cubic-bezier(.22,1,.36,1)"
            }
        ).onfinish = () => particle.remove();
    }
}


/* =========================================================
   SECRET EASTER EGG
   ↑ ↑ ↓ ↓ ← → ← →
========================================================= */

const secretCode = [
    "ArrowUp", "ArrowUp",
    "ArrowDown", "ArrowDown",
    "ArrowLeft", "ArrowRight",
    "ArrowLeft", "ArrowRight"
];
let secretIndex = 0;

document.addEventListener("keydown", event => {
    if (event.key === secretCode[secretIndex]) {
        secretIndex++;
        if (secretIndex === secretCode.length) {
            secretIndex = 0;
            showSecret();
        }
    } else {
        secretIndex = 0;
    }
});

function showSecret() {
    SoundEngine.fanfare();

    const secret = document.createElement("div");
    secret.setAttribute("role", "dialog");
    secret.setAttribute("aria-modal", "true");
    secret.style.position = "fixed";
    secret.style.inset = "0";
    secret.style.display = "flex";
    secret.style.alignItems = "center";
    secret.style.justifyContent = "center";
    secret.style.background = "rgba(0,0,0,0.94)";
    secret.style.zIndex = "1200";
    secret.style.fontFamily = '"Cormorant Garamond", serif';
    secret.style.fontSize = "clamp(2rem,5vw,4rem)";
    secret.style.textAlign = "center";
    secret.style.padding = "30px";
    secret.style.cursor = "pointer";

    /*
        CHANGE THIS SECRET MESSAGE. Good spot for a private inside
        joke, something ridiculous, a hidden compliment, or a
        callback to the first time you talked.
    */
    secret.textContent = "You found something you weren't supposed to find.";

    document.body.appendChild(secret);

    secret.addEventListener("click", () => secret.remove());
    document.addEventListener(
        "keydown",
        event => {
            if (event.key === "Escape") secret.remove();
        },
        { once: true }
    );
}
