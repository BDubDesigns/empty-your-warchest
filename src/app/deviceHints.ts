import type { DeviceHints } from '../core';

type GL = WebGLRenderingContext | WebGL2RenderingContext;

const text = (value: unknown): string => (typeof value === 'string' ? value : String(value));

/**
 * The GPU's name and maker as WebGL gives them: the real ones where the browser shares them
 * (Chrome does, "Mali-G57 MC2"), else whatever it says instead.
 */
export function gpuOf(gl: GL): { gpu: string; vendor: string } {
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    gpu: text(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER)),
    vendor: text(gl.getParameter(debug ? debug.UNMASKED_VENDOR_WEBGL : gl.VENDOR)),
  };
}

/** What the browser says about the phone before any WebGL (the GPU comes with the first context). */
export function deviceHints(): DeviceHints {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    ...(nav.deviceMemory !== undefined ? { memoryGb: nav.deviceMemory } : {}),
    ...(navigator.hardwareConcurrency ? { cores: navigator.hardwareConcurrency } : {}),
  };
}
