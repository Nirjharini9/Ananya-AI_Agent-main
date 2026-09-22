import React, { useEffect, useRef } from "react";

const layers = [
  {
    width: 0.16,
    alpha: 0.30,
    glow: 82,
    speed: 1,
    offset: 0.00,
    hue: 270,
  },
  {
    width: 0.11,
    alpha: 0.48,
    glow: 96,
    speed: 2,
    offset: 0.17,
    hue: 280,
  },
  {
    width: 0.07,
    alpha: 0.68,
    glow: 100,
    speed: 3,
    offset: 0.33,
    hue: 290,
  },
  {
    width: 0.025,
    alpha: 0.95,
    glow: 160,
    speed: 2,
    offset: 0.49,
    hue: 300,
  },
];

const TAU = Math.PI * 2;
const LOOP_SECONDS = 12;

export default function MovingPurpleWave() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) return;

    const ctx = canvas.getContext("2d");

    if (!ctx) return;

    let width = 0;
    let height = 0;
    let dpr = 1;

    let animationFrame = 0;

    const start = performance.now();

    const resize = () => {
      const rect = canvas.getBoundingClientRect();

      dpr = Math.min(window.devicePixelRatio || 1, 2);

      width = rect.width;
      height = rect.height;

      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const waveY = (
      x: number,
      phase: number,
      layerIndex: number
    ) => {
      const u = x / width;

      const center = height * 0.63;

      const scale = Math.min(width, height);

      const amplitude =
        scale * (0.095 + layerIndex * 0.006);

      const primary = Math.sin(
        u * TAU * 2.2 +
          phase * 2 +
          layerIndex * 0.38
      );

      const secondary =
        Math.sin(
          u * TAU * 2.24 -
            phase * 3 +
            layerIndex * 0.61
        ) * 0.2;

      const tertiary =
        Math.sin(
          u * TAU * 0.56 +
            phase +
            1.2
        ) * 0.12;

      return (
        center +
        (primary + secondary + tertiary) *
          amplitude
      );
    };

    const drawRibbon = (
      layer: (typeof layers)[number],
      index: number,
      phase: number
    ) => {
      const step = Math.max(5, width / 190);

      const center = height * 0.53;

      const thickness =
        Math.min(width, height) *
        layer.width;

      const points: {
        x: number;
        y: number;
      }[] = [];

      for (
        let x = -step;
        x <= width + step;
        x += step
      ) {
        points.push({
          x,
          y: waveY(
            x,
            phase * layer.speed +
              layer.offset,
            index
          ),
        });
      }

      ctx.save();

      ctx.lineJoin = "round";
      ctx.lineCap = "round";

      ctx.globalCompositeOperation = "screen";

     ctx.shadowColor = `hsla(
  ${layer.hue},
  100%,
  62%,
  ${Math.min(
    0.9,
    layer.alpha * 3
  )}
)`;

      ctx.shadowBlur = layer.glow + 50 ;

      const top: {
        x: number;
        y: number;
      }[] = [];

      const bottom: {
        x: number;
        y: number;
      }[] = [];

      for (let i = 0; i < points.length; i++) {
        const p = points[i];

        const u = p.x / width;

        const edge =
          0.86 +
          0.14 * Math.sin(u * Math.PI);

        const local =
          thickness * edge;

        top.push({
          x: p.x,
          y: p.y - local * 0.55,
        });

        bottom.push({
          x: p.x,
          y: p.y + local * 0.55,
        });
      }

      // Ribbon gradient

      const gradient =
        ctx.createLinearGradient(
          0,
          center - thickness,
          0,
          center + thickness
        );

      gradient.addColorStop(
        0,
        `hsla(
          ${layer.hue - 10},
          100%,
          68%,
          0
        )`
      );

      gradient.addColorStop(
        0.25,
        `hsla(
          ${layer.hue},
          100%,
          68%,
          ${layer.alpha * 0.9}
        )`
      );

      gradient.addColorStop(
        0.52,
        `hsla(
          ${layer.hue + 8},
          100%,
          75%,
          ${layer.alpha}
        )`
      );

      gradient.addColorStop(
        0.78,
        `hsla(
          ${layer.hue},
          100%,
          62%,
          ${layer.alpha * 0.72}
        )`
      );

      gradient.addColorStop(
        1,
        `hsla(
          ${layer.hue - 8},
          100%,
          58%,
          0
        )`
      );

      ctx.fillStyle = gradient;

      ctx.beginPath();

      ctx.moveTo(
        top[0].x,
        top[0].y
      );

      for (
        let i = 1;
        i < top.length;
        i++
      ) {
        ctx.lineTo(
          top[i].x,
          top[i].y
        );
      }

      for (
        let i = bottom.length - 1;
        i >= 0;
        i--
      ) {
        ctx.lineTo(
          bottom[i].x,
          bottom[i].y
        );
      }

      ctx.closePath();

      ctx.fill();

      // Top highlight

      ctx.strokeStyle = `hsla(
  ${layer.hue + 5},
  100%,
  72%,
  ${Math.min(
    1,
    layer.alpha + 0.15
  )}
)`;

    //   ctx.lineWidth = Math.max(
    //     0.7,
    //     thickness * 0.035
    //   );
    // Strong glowing neon line

ctx.strokeStyle = "rgba(255, 120, 255, 1)";

ctx.shadowColor = "rgba(220, 50, 255, 1)";
ctx.shadowBlur = 28;

ctx.lineWidth = 1.4;

      ctx.beginPath();

      ctx.moveTo(
        top[0].x,
        top[0].y
      );

      for (
        let i = 1;
        i < top.length;
        i++
      ) {
        ctx.lineTo(
          top[i].x,
          top[i].y
        );
      }

      ctx.stroke();

      // Bright lower highlight

      if (index === layers.length - 1) {
        ctx.strokeStyle =
  "rgba(245, 190, 255, 0.98)";

        ctx.lineWidth = 1.15;

        ctx.shadowBlur = 15;

        ctx.beginPath();

        ctx.moveTo(
          bottom[0].x,
          bottom[0].y
        );

        for (
          let i = 1;
          i < bottom.length;
          i++
        ) {
          ctx.lineTo(
            bottom[i].x,
            bottom[i].y
          );
        }

        ctx.stroke();
      }

      ctx.restore();
    };

    const render = (now: number) => {
      const elapsed =
        (now - start) / 1000;

      const phase =
        ((elapsed % LOOP_SECONDS) /
          LOOP_SECONDS) *
        TAU;

      ctx.setTransform(
        dpr,
        0,
        0,
        dpr,
        0,
        0
      );

      // Transparent canvas
      ctx.clearRect(
        0,
        0,
        width,
        height
      );

      // Soft purple haze

      const haze =
        ctx.createRadialGradient(
          width * 0.5,
          height * 0.53,
          0,
          width * 0.5,
          height * 0.53,
          Math.min(
            width,
            height
          ) * 0.44
        );

      haze.addColorStop(
        0,
        "rgba(66, 0, 130, 0.055)"
      );

      haze.addColorStop(
        1,
        "rgba(0, 0, 0, 0)"
      );

      ctx.fillStyle = haze;

      ctx.fillRect(
        0,
        0,
        width,
        height
      );

      // Draw ribbons

      for (
        let i = 0;
        i < layers.length;
        i++
      ) {
        drawRibbon(
          layers[i],
          i,
          phase
        );
      }

      animationFrame =
        requestAnimationFrame(
          render
        );
    };

    resize();

    window.addEventListener(
      "resize",
      resize
    );

    animationFrame =
      requestAnimationFrame(render);

    return () => {
      window.removeEventListener(
        "resize",
        resize
      );

      cancelAnimationFrame(
        animationFrame
      );
    };
  }, []);

  return (
    <div className="moving-wave-container">
      <canvas
        ref={canvasRef}
        className="moving-wave-canvas"
      />
    </div>
  );
}