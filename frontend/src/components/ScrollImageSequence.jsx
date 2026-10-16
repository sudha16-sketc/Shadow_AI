import React, { useEffect, useRef, useState, useCallback } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const TOTAL_FRAMES = 192;

// Helper to construct exact frame filenames in numerical order (frame_001.jpg -> frame_192.jpg)
const getFrameUrl = (index) => {
  const frameNum = String(index + 1).padStart(3, '0');
  const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
  return `${base}/Developer_pressing_Enter_key_20261016001411_frames/frame_${frameNum}.jpg`;
};

const narrativeSections = [
  {
    start: 0,
    end: 0.25,
    eyebrow: "THE GATEKEEPER",
    title: "SHADOW AI",
    description: "Security between your keystrokes and AI.",
  },
  {
    start: 0.25,
    end: 0.50,
    eyebrow: "01 / THREAT DETECTED",
    title: "YOUR SECRETS DON'T BELONG IN PROMPTS.",
    description: "Sensitive code, credentials, and proprietary data can leak through everyday AI interactions.",
  },
  {
    start: 0.50,
    end: 0.75,
    eyebrow: "02 / REAL-TIME DEFENSE",
    title: "DETECT. REDACT. PROTECT.",
    description: "Inspect prompts and enforce security policies before sensitive information is submitted.",
  },
  {
    start: 0.75,
    end: 1,
    eyebrow: "03 / CONTROL RESTORED",
    title: "INNOVATION WITHOUT EXPOSURE.",
    description: "Give teams the freedom to use AI while protecting organizational data.",
  },
];

export default function ScrollImageSequence() {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const imagesRef = useRef([]);
  const currentFrameRef = useRef(0);
  const lastDrawnFrameRef = useRef(-1);
  const sectionsRef = useRef([]);


  const [loadedCount, setLoadedCount] = useState(0);
  const [isFullyLoaded, setIsFullyLoaded] = useState(false);

  // High-performance canvas drawing with aspect-ratio cover and DPR scaling
  const drawImageToCanvas = useCallback((img) => {
    const canvas = canvasRef.current;
    if (!canvas || !img || !img.complete || img.naturalWidth === 0) return;

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const targetW = Math.round(rect.width * dpr);
    const targetH = Math.round(rect.height * dpr);

    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }

    // Fill background with Shadow AI palette deep void (#0d0d0d)
    ctx.fillStyle = '#0d0d0d';
    ctx.fillRect(0, 0, targetW, targetH);

    // Cover algorithm preserving original 16:9 aspect ratio (1280 x 720) without distortion
    const imgW = img.naturalWidth || 1280;
    const imgH = img.naturalHeight || 720;
    const imgRatio = imgW / imgH;
    const canvasRatio = targetW / targetH;

    let drawW, drawH, drawX, drawY;

    if (canvasRatio > imgRatio) {
      drawW = targetW;
      drawH = targetW / imgRatio;
      drawX = 0;
      drawY = (targetH - drawH) / 2;
    } else {
      drawH = targetH;
      drawW = targetH * imgRatio;
      drawX = (targetW - drawW) / 2;
      drawY = 0;
    }

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, drawX, drawY, drawW, drawH);

    // Canvas-level radial vignette to deepen corners and preserve cinematic look
    const maxDim = Math.max(targetW, targetH);
    const minDim = Math.min(targetW, targetH);
    const vignette = ctx.createRadialGradient(
      targetW / 2, targetH / 2, minDim * 0.35,
      targetW / 2, targetH / 2, maxDim * 0.72
    );
    vignette.addColorStop(0, 'rgba(13, 13, 13, 0)');
    vignette.addColorStop(0.55, 'rgba(13, 13, 13, 0.28)');
    vignette.addColorStop(0.85, 'rgba(13, 13, 13, 0.75)');
    vignette.addColorStop(1, '#0d0d0d');

    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, targetW, targetH);
  }, []);

  // Frame renderer with anti-flicker nearest-frame fallback
  const renderFrame = useCallback((targetIndex) => {
    const idx = Math.min(TOTAL_FRAMES - 1, Math.max(0, targetIndex));
    currentFrameRef.current = idx;

    const images = imagesRef.current;
    let imgToDraw = images[idx];

    // If target frame is not yet ready, search nearest loaded frame to eliminate flickering
    if (!imgToDraw || !imgToDraw.complete || imgToDraw.naturalWidth === 0) {
      for (let offset = 1; offset < TOTAL_FRAMES; offset++) {
        const prev = idx - offset;
        if (prev >= 0 && images[prev]?.complete && images[prev]?.naturalWidth > 0) {
          imgToDraw = images[prev];
          break;
        }
        const next = idx + offset;
        if (next < TOTAL_FRAMES && images[next]?.complete && images[next]?.naturalWidth > 0) {
          imgToDraw = images[next];
          break;
        }
      }
    }

    // Default fallback to first frame if none found
    if (!imgToDraw || !imgToDraw.complete) {
      imgToDraw = images[0];
    }

    if (imgToDraw && imgToDraw.complete && imgToDraw.naturalWidth > 0) {
      lastDrawnFrameRef.current = idx;
      drawImageToCanvas(imgToDraw);
    }
  }, [drawImageToCanvas]);

  // Frame preloading: Priority 1 loads frame 0 instantly; remaining frames loaded concurrently in pool
  useEffect(() => {
    let isCancelled = false;
    const images = new Array(TOTAL_FRAMES);
    imagesRef.current = images;

    // 1. Instant load for Frame 0 (initial view)
    const firstImg = new Image();
    firstImg.src = getFrameUrl(0);
    firstImg.onload = () => {
      if (isCancelled) return;
      images[0] = firstImg;
      setLoadedCount(prev => prev + 1);
      renderFrame(0);
    };

    // 2. Load remaining frames with concurrent worker pool
    const queue = [];
    for (let i = 1; i < TOTAL_FRAMES; i++) {
      queue.push(i);
    }

    const loadSingleFrame = (frameIndex) => {
      return new Promise((resolve) => {
        const img = new Image();
        img.src = getFrameUrl(frameIndex);
        img.onload = () => {
          if (!isCancelled) {
            images[frameIndex] = img;
            setLoadedCount(prev => prev + 1);
            // If the user is currently parked on this frame, refresh canvas immediately
            if (currentFrameRef.current === frameIndex) {
              renderFrame(frameIndex);
            }
          }
          resolve();
        };
        img.onerror = () => {
          resolve();
        };
      });
    };

    const workerCount = 6;
    const workers = Array.from({ length: workerCount }, async () => {
      while (queue.length > 0 && !isCancelled) {
        const nextIdx = queue.shift();
        if (nextIdx !== undefined) {
          await loadSingleFrame(nextIdx);
        }
      }
    });

    Promise.all(workers).then(() => {
      if (!isCancelled) {
        setIsFullyLoaded(true);
      }
    });

    return () => {
      isCancelled = true;
    };
  }, [renderFrame]);

  // GSAP ScrollTrigger synchronization (frames + cinematic text timelines)

  // GSAP ScrollTrigger: cinematic text + synchronized image sequence
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const ctx = gsap.context(() => {
      const sections = sectionsRef.current.filter(Boolean);

      const getItems = (index) =>
        sections[index]?.querySelectorAll("[data-animate]");

      // Establish deterministic initial states.
      sections.forEach((section, index) => {
        gsap.set(getItems(index), {
          opacity: 0,
          y: 36,
          filter: "blur(8px)",
        });
      });

      // Intro animates immediately, without waiting for scroll.
      const intro = gsap.timeline();
      intro.fromTo(
        getItems(0),
        {
          opacity: 0,
          y: 36,
          filter: "blur(8px)",
        },
        {
          opacity: 1,
          y: 0,
          filter: "blur(0px)",
          duration: 1.1,
          stagger: 0.14,
          ease: "power3.out",
        }
      );

      // One timeline controls all scroll-driven text transitions.
      const textTimeline = gsap.timeline({ paused: true });

      // First section exits as the second enters.
      textTimeline.fromTo(
        getItems(0),
        { opacity: 1, y: 0, filter: "blur(0px)" },
        {
          opacity: 0,
          y: -32,
          filter: "blur(8px)",
          duration: 0.10,
          stagger: 0.02,
          ease: "power2.in",
          immediateRender: false,
        },
        0.19
      );

      // Alternating positions: left, right, left, right.
      const transitions = [
        { index: 1, enter: 0.20, exit: 0.43 },
        { index: 2, enter: 0.45, exit: 0.68 },
        { index: 3, enter: 0.70, exit: 1.05 },
      ];

      transitions.forEach(({ index, enter, exit }) => {
        textTimeline.fromTo(
          getItems(index),
          {
            opacity: 0,
            x: index % 2 === 1 ? 55 : -55,
            y: 20,
            filter: "blur(8px)",
          },
          {
            opacity: 1,
            x: 0,
            y: 0,
            filter: "blur(0px)",
            duration: 0.10,
            stagger: 0.035,
            ease: "power3.out",
            immediateRender: false,
          },
          enter
        );

        textTimeline.to(
          getItems(index),
          {
            opacity: 0,
            x: index % 2 === 1 ? -45 : 45,
            y: -15,
            filter: "blur(8px)",
            duration: 0.09,
            stagger: 0.02,
            ease: "power2.in",
            immediateRender: false,
          },
          exit
        );
      });

      // Single ScrollTrigger controls both frames and text.
      const trigger = ScrollTrigger.create({
        trigger: container,
        start: "top top",
        end: "+=2800",
        pin: true,
        pinSpacing: true,
        scrub: 0.15,

        onUpdate: (self) => {
          const progress = self.progress;

          const targetFrame = Math.min(
            TOTAL_FRAMES - 1,
            Math.max(0, Math.floor(progress * TOTAL_FRAMES))
          );

          renderFrame(targetFrame);

          if (progress > 0) {
            // Prevent the opening animation fighting the scroll timeline.
            if (intro.isActive()) {
              intro.progress(1).pause();
            }

            textTimeline.progress(progress);
          } else {
            // Restore the opening section at the top of the page.
            textTimeline.progress(0);
          }
        },

        onLeaveBack: () => {
          textTimeline.progress(0);
          intro.restart();
        },
      });

      const handleResize = () => {
        renderFrame(currentFrameRef.current);
        ScrollTrigger.refresh();
      };

      window.addEventListener("resize", handleResize);

      return () => {
        window.removeEventListener("resize", handleResize);
        trigger.kill();
        intro.kill();
        textTimeline.kill();
      };
    }, containerRef);

    return () => ctx.revert();
  }, [renderFrame]);

  return (
    <div
      ref={containerRef}
      className="relative w-full h-screen overflow-hidden bg-[#0d0d0d] select-none"
    >


      {/* HTML Canvas Layer */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full block z-0"
      />

      {/* Cinematic Darkened Corners & Vignette Layer */}
      <div
        className="absolute inset-0 pointer-events-none z-10"
        style={{
          background: `
            radial-gradient(circle at center, transparent 35%, rgba(13,13,13,0.35) 65%, rgba(13,13,13,0.92) 88%, #0d0d0d 100%),
            linear-gradient(to bottom, rgba(13,13,13,0.85) 0%, transparent 16%, transparent 84%, #0d0d0d 100%),
            linear-gradient(to right, rgba(13,13,13,0.8) 0%, transparent 20%, transparent 80%, rgba(13,13,13,0.8) 100%)
          `,
        }}
      />

      {/* Cybernetic Scanline Texture Overlay */}
      <div
        className="absolute inset-0 pointer-events-none z-10 opacity-[0.035]"
        style={{
          backgroundImage: 'linear-gradient(rgba(242, 242, 242, 0.1) 1px, transparent 1px)',
          backgroundSize: '100% 3px',
        }}
      />

      {/* Shadow AI Subtle Hue Accent Overlay */}
      <div
        className="absolute inset-0 pointer-events-none z-10 opacity-25"
        style={{
          background: 'radial-gradient(ellipse 60% 50% at 75% 65%, rgba(26, 26, 0, 0.4) 0%, transparent 70%)',
        }}
      />

      {/* Scroll-Synchronized Story Sections (animated entirely by GSAP) */}
      <div className="absolute inset-0 z-20 pointer-events-none">

        {narrativeSections.map((section, index) => {
          const alignRight = index % 2 === 1;

          return (
            <section
              key={section.title}
              ref={(el) => {
                sectionsRef.current[index] = el;
              }}
              className={`absolute inset-0 flex items-center px-[7vw] md:px-[9vw] ${alignRight ? "justify-end" : "justify-start"
                }`}
            >
              <div
                className={`w-[88%] sm:w-[78%] lg:w-[48%] max-w-2xl ${alignRight ? "text-right" : "text-left"
                  }`}
              >
                <p
                  data-animate
                  className="mb-5 text-xs md:text-sm font-mono tracking-[0.35em] text-red-500"
                >
                  {section.eyebrow}
                </p>

                <h1
                  data-animate
                  className="text-4xl sm:text-5xl md:text-7xl lg:text-8xl font-black uppercase leading-[0.95] tracking-tight text-white"
                >
                  {section.title}
                </h1>

                <p
                  data-animate
                  className={`mt-6 max-w-xl text-base md:text-lg leading-relaxed text-neutral-300 ${alignRight ? "ml-auto" : ""
                    }`}
                >
                  {section.description}
                </p>
              </div>
            </section>
          );
        })}

      </div>


      {/* FRAME PRELOAD STATUS INDICATOR */}
      {!isFullyLoaded && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 px-3 py-1 rounded-full bg-[#0d0d0d]/90 border border-[#1a1a00] text-[10px] font-mono text-[#b3b3b3] backdrop-blur-md flex items-center gap-2 pointer-events-none">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#ff0000] animate-pulse" />
          <span>PRELOADING HIGH-RES FRAMES: {Math.round((loadedCount / TOTAL_FRAMES) * 100)}%</span>
        </div>
      )}


    </div>
  );
}
