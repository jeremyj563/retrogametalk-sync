import { useEffect, useRef, useState } from 'react';
import {
  computeSyncSpeedWaveParams,
  CRT_PALETTES,
  type CrtPalette,
  type CrtUiMotionLevel,
  isSyncSpeedWaveActive,
} from '../shared/crtDisplay';

interface SyncSpeedWaveCanvasProps {
  bytesPerSec: number;
  uiMotion: CrtUiMotionLevel;
  syncSpeedWave: boolean;
  active: boolean;
  palette: CrtPalette;
  isDryRun?: boolean;
}

const DRY_RUN_AMBER_RGB = '242, 178, 51';

/**
 * Phase-continuous CRT oscilloscope sine-wave backdrop for the Sync Status card.
 * Smoothly accelerates wave travel frequency and spatial density as download
 * throughput increases, scales with Living UI Motion tiers, respects
 * prefers-reduced-motion & tab visibility, and can be toggled off independently.
 */
export function SyncSpeedWaveCanvas({
  bytesPerSec,
  uiMotion,
  syncSpeedWave,
  active,
  palette,
  isDryRun = false,
}: SyncSpeedWaveCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [reducedMotion, setReducedMotion] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReducedMotion(mq.matches);
    onChange();
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  const enabled = active && !reducedMotion && isSyncSpeedWaveActive({ uiMotion, syncSpeedWave });
  const targetParams = computeSyncSpeedWaveParams(bytesPerSec, uiMotion, syncSpeedWave);

  const targetRef = useRef(targetParams);
  targetRef.current = targetParams;

  const colorRgbRef = useRef(isDryRun ? DRY_RUN_AMBER_RGB : CRT_PALETTES[palette].rgb);
  colorRgbRef.current = isDryRun ? DRY_RUN_AMBER_RGB : CRT_PALETTES[palette].rgb;

  useEffect(() => {
    if (!enabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = 0;
    let height = 0;
    let dpr = 1;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const nextW = Math.round(width * dpr);
      const nextH = Math.round(height * dpr);
      if (canvas.width !== nextW || canvas.height !== nextH) {
        canvas.width = nextW;
        canvas.height = nextH;
      }
    };

    resize();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    observer?.observe(canvas);

    let rafId: number | null = null;
    let lastTs = performance.now();
    let phase = 0;
    let harmonicPhase = 0;
    let smoothFreq = targetRef.current.frequencyHz;
    let smoothCycles = targetRef.current.spatialCycles;
    let smoothAmp = targetRef.current.amplitudeRatio;
    let smoothPrimaryOpacity = targetRef.current.primaryOpacity;
    let smoothHarmonicOpacity = targetRef.current.harmonicOpacity;
    let smoothFillOpacity = targetRef.current.fillOpacity;
    let smoothGlow = targetRef.current.glowPx;
    let smoothLineWidth = targetRef.current.lineWidth;

    const drawFrame = (now: number) => {
      if (document.hidden) {
        rafId = null;
        return;
      }

      const dt = Math.min(0.06, Math.max(0.001, (now - lastTs) / 1000));
      lastTs = now;

      const t = targetRef.current;
      const blend = 1 - Math.exp(-dt * 4.5);
      smoothFreq += (t.frequencyHz - smoothFreq) * blend;
      smoothCycles += (t.spatialCycles - smoothCycles) * blend;
      smoothAmp += (t.amplitudeRatio - smoothAmp) * blend;
      smoothPrimaryOpacity += (t.primaryOpacity - smoothPrimaryOpacity) * blend;
      smoothHarmonicOpacity += (t.harmonicOpacity - smoothHarmonicOpacity) * blend;
      smoothFillOpacity += (t.fillOpacity - smoothFillOpacity) * blend;
      smoothGlow += (t.glowPx - smoothGlow) * blend;
      smoothLineWidth += (t.lineWidth - smoothLineWidth) * blend;

      phase = (phase + dt * smoothFreq * Math.PI * 2) % (Math.PI * 2000);
      harmonicPhase = (harmonicPhase + dt * smoothFreq * 1.42 * Math.PI * 2) % (Math.PI * 2000);

      if (width > 1 && height > 1) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);

        const rgb = colorRgbRef.current;
        const centerY = height * 0.56;
        const maxAmpPx = height * 0.36 * smoothAmp;
        const steps = Math.max(48, Math.min(180, Math.round(width / 5)));

        // Subtle horizontal oscilloscope center graticule
        if (smoothHarmonicOpacity > 0.02) {
          const axisGrad = ctx.createLinearGradient(0, 0, width, 0);
          axisGrad.addColorStop(0, `rgba(${rgb}, 0)`);
          axisGrad.addColorStop(0.14, `rgba(${rgb}, ${(smoothPrimaryOpacity * 0.24).toFixed(3)})`);
          axisGrad.addColorStop(0.86, `rgba(${rgb}, ${(smoothPrimaryOpacity * 0.24).toFixed(3)})`);
          axisGrad.addColorStop(1, `rgba(${rgb}, 0)`);
          ctx.beginPath();
          ctx.moveTo(0, centerY);
          ctx.lineTo(width, centerY);
          ctx.strokeStyle = axisGrad;
          ctx.lineWidth = 1;
          ctx.shadowBlur = 0;
          ctx.stroke();
        }

        // Secondary harmonic echo trace on Medium/High/Ultra
        if (smoothHarmonicOpacity > 0.01) {
          const harmGrad = ctx.createLinearGradient(0, 0, width, 0);
          harmGrad.addColorStop(0, `rgba(${rgb}, 0)`);
          harmGrad.addColorStop(0.12, `rgba(${rgb}, ${smoothHarmonicOpacity.toFixed(3)})`);
          harmGrad.addColorStop(0.88, `rgba(${rgb}, ${smoothHarmonicOpacity.toFixed(3)})`);
          harmGrad.addColorStop(1, `rgba(${rgb}, 0)`);

          ctx.beginPath();
          for (let i = 0; i <= steps; i += 1) {
            const u = i / steps;
            const x = u * width;
            // Smooth cosine edge taper so wave enters/exits cleanly
            const envelope = Math.sin(u * Math.PI);
            const env = envelope * envelope;
            const y =
              centerY +
              Math.sin(u * smoothCycles * 1.55 * Math.PI * 2 - harmonicPhase + 0.9) *
                maxAmpPx *
                0.62 *
                env;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.strokeStyle = harmGrad;
          ctx.lineWidth = Math.max(1, smoothLineWidth * 0.72);
          ctx.shadowBlur = 0;
          ctx.stroke();
        }

        // Primary speed-reactive phosphor carrier trace + subtle under-ribbon fill
        const primaryPointsX = new Float32Array(steps + 1);
        const primaryPointsY = new Float32Array(steps + 1);
        for (let i = 0; i <= steps; i += 1) {
          const u = i / steps;
          const x = u * width;
          const envelope = Math.sin(u * Math.PI);
          const env = Math.pow(envelope, 1.35);
          const fundamental = Math.sin(u * smoothCycles * Math.PI * 2 - phase);
          const overtone =
            smoothHarmonicOpacity > 0.01
              ? 0.18 * Math.sin(u * smoothCycles * 2.0 * Math.PI * 2 - phase * 1.35)
              : 0;
          const y = centerY + (fundamental + overtone) * maxAmpPx * env;
          primaryPointsX[i] = x;
          primaryPointsY[i] = y;
        }

        // Soft phosphor fill under primary wave
        if (smoothFillOpacity > 0.005) {
          const fillGrad = ctx.createLinearGradient(0, centerY - maxAmpPx, 0, height);
          fillGrad.addColorStop(0, `rgba(${rgb}, ${smoothFillOpacity.toFixed(3)})`);
          fillGrad.addColorStop(1, `rgba(${rgb}, 0)`);

          ctx.beginPath();
          ctx.moveTo(primaryPointsX[0], primaryPointsY[0]);
          for (let i = 1; i <= steps; i += 1) {
            ctx.lineTo(primaryPointsX[i], primaryPointsY[i]);
          }
          ctx.lineTo(width, height);
          ctx.lineTo(0, height);
          ctx.closePath();
          ctx.fillStyle = fillGrad;
          ctx.shadowBlur = 0;
          ctx.fill();
        }

        // Primary oscilloscope beam stroke
        const beamGrad = ctx.createLinearGradient(0, 0, width, 0);
        beamGrad.addColorStop(0, `rgba(${rgb}, 0)`);
        beamGrad.addColorStop(0.1, `rgba(${rgb}, ${smoothPrimaryOpacity.toFixed(3)})`);
        beamGrad.addColorStop(0.5, `rgba(${rgb}, ${Math.min(0.95, smoothPrimaryOpacity * 1.15).toFixed(3)})`);
        beamGrad.addColorStop(0.9, `rgba(${rgb}, ${smoothPrimaryOpacity.toFixed(3)})`);
        beamGrad.addColorStop(1, `rgba(${rgb}, 0)`);

        ctx.beginPath();
        ctx.moveTo(primaryPointsX[0], primaryPointsY[0]);
        for (let i = 1; i <= steps; i += 1) {
          ctx.lineTo(primaryPointsX[i], primaryPointsY[i]);
        }
        ctx.strokeStyle = beamGrad;
        ctx.lineWidth = smoothLineWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.shadowColor = `rgba(${rgb}, ${Math.min(0.85, smoothPrimaryOpacity * 0.9).toFixed(3)})`;
        ctx.shadowBlur = smoothGlow;
        ctx.stroke();
      }

      rafId = window.requestAnimationFrame(drawFrame);
    };

    const startLoop = () => {
      if (rafId === null && !document.hidden) {
        lastTs = performance.now();
        rafId = window.requestAnimationFrame(drawFrame);
      }
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        if (rafId !== null) {
          window.cancelAnimationFrame(rafId);
          rafId = null;
        }
      } else {
        startLoop();
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    startLoop();

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      observer?.disconnect();
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [enabled]);

  if (!enabled) return null;

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      data-sync-speed-wave="active"
      className="pointer-events-none absolute inset-x-0 bottom-0 h-16 w-full z-0 opacity-95"
    />
  );
}
