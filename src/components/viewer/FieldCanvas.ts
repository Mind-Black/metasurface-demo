import { opticsStore, OpticsState } from '@/lib/store/useOpticsStore';
import { fieldClient, FieldRequest } from '@/lib/optics/fieldClient';
import { deviceKey } from '@/lib/optics/propagation';

const VS_SOURCE = `#version 300 es
in vec2 aPosition;
out vec2 vUv;
void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

/** GLSL shared by the field panels: the computed field texture and the colormaps. */
export const FIELD_GLSL = `
uniform highp sampler2D uField;
const float PI = 3.14159265358979323846;

vec3 inferno(float t) {
  const vec3 c0 = vec3(0.0002149, 0.001394, 0.005860);
  const vec3 c1 = vec3(0.258078, -0.008487, 0.505679);
  const vec3 c2 = vec3(0.781807, 0.252771, -0.651531);
  const vec3 c3 = vec3(0.710764, 0.958563, -0.130058);
  const vec3 c4 = vec3(-0.731634, -0.203976, 0.279767);
  return clamp(c0 + t * (c1 + t * (c2 + t * (c3 + t * c4))), 0.0, 1.0);
}

vec3 phaseColormap(float phase) {
  float norm = (phase + PI) / (2.0 * PI);
  return 0.5 + 0.5 * cos(2.0 * PI * norm + vec3(0.0, 2.0, 4.0) * PI / 3.0);
}

// Complex field at normalized coordinates, bilinear in re and im (RG32F is not filterable).
vec2 sampleField(vec2 uv) {
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec2(0.0);
  ivec2 size = textureSize(uField, 0);
  vec2 p = uv * vec2(size) - 0.5;
  ivec2 i = ivec2(floor(p));
  vec2 f = p - vec2(i);
  ivec2 hi = size - 1;
  ivec2 a = clamp(i, ivec2(0), hi);
  ivec2 b = clamp(i + 1, ivec2(0), hi);
  vec2 row0 = mix(texelFetch(uField, a, 0).rg, texelFetch(uField, ivec2(b.x, a.y), 0).rg, f.x);
  vec2 row1 = mix(texelFetch(uField, ivec2(a.x, b.y), 0).rg, texelFetch(uField, b, 0).rg, f.x);
  return mix(row0, row1, f.y);
}

vec3 fieldColor(vec2 field, int mode, int logScale, float intensityMax) {
  if (mode == 0) {
    float val = clamp(field.x * 0.7, -1.0, 1.0);
    return val > 0.0
      ? mix(vec3(0.04, 0.05, 0.09), vec3(0.12, 0.85, 1.0), val)
      : mix(vec3(0.04, 0.05, 0.09), vec3(1.0, 0.2, 0.45), -val);
  }
  if (mode == 1) {
    float normI = clamp(dot(field, field) / max(0.001, intensityMax), 0.0, 1.0);
    if (logScale == 1) normI = clamp(1.0 + log(max(normI, 0.0001)) / (4.0 * log(10.0)), 0.0, 1.0);
    return inferno(normI);
  }
  return phaseColormap(atan(field.y, field.x));
}
`;

/**
 * Displays a complex field solved off-thread. A new solve runs only when the device or view
 * changes; every frame just advances the time factor exp(-iωt) in the shader.
 */
export abstract class FieldCanvas {
  protected canvas: HTMLCanvasElement;
  protected gl: WebGL2RenderingContext | null = null;
  protected uniformLocations: Record<string, WebGLUniformLocation | null> = {};
  protected shown: FieldRequest | null = null;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private texture: WebGLTexture | null = null;
  private animFrameId: number | null = null;
  private running = false;
  /** Something changed since the last draw. Idle panels draw only when this is set. */
  private dirty = true;
  /** Scrolled into (or near) view and not in a hidden tab. */
  private visible = true;
  private lastWidth = 0;
  private lastHeight = 0;
  /** While a panel is being resized the request key changes every frame; wait for it to settle. */
  private settleUntil = 0;
  private unsubscribe: (() => void) | null = null;
  private intersection: IntersectionObserver | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private startTime = performance.now();
  private currentTime = 0;
  private requestedKey = '';

  protected constructor(canvas: HTMLCanvasElement, fragmentSource: string, uniforms: string[]) {
    this.canvas = canvas;
    this.initWebGL(fragmentSource, uniforms);
  }

  protected abstract fieldRequest(state: OpticsState): FieldRequest | null;
  protected abstract setUniforms(gl: WebGL2RenderingContext, state: OpticsState): void;

  private initWebGL(fragmentSource: string, uniforms: string[]): void {
    const gl = this.canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'default' });
    if (!gl) {
      console.error('WebGL2 not supported on this device.');
      return;
    }
    this.gl = gl;
    const vs = this.compileShader(gl.VERTEX_SHADER, VS_SOURCE);
    const fs = this.compileShader(gl.FRAGMENT_SHADER, fragmentSource);
    const program = gl.createProgram();
    if (!vs || !fs || !program) return;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Program link error:', gl.getProgramInfoLog(program));
      return;
    }
    this.program = program;

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'aPosition');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    for (const name of ['uField', 'uTime', 'uResolution', 'uRenderMode', 'uLogIntensity', 'uIntensityMax', ...uniforms]) {
      this.uniformLocations[name] = gl.getUniformLocation(program, name);
    }

    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, 1, 1, 0, gl.RG, gl.FLOAT, new Float32Array(2));
  }

  private compileShader(type: number, source: string): WebGLShader | null {
    const gl = this.gl!;
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('Shader compile error:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  private syncField(state: OpticsState): void {
    const request = this.fieldRequest(state);
    if (!request) return;
    const { device, ...view } = request;
    const key = `${deviceKey(device)}#${JSON.stringify(view)}`;
    if (key === this.requestedKey) return;
    this.requestedKey = key;
    fieldClient.request(request, ({ request: solved, field }) => {
      const gl = this.gl;
      if (!gl || !field) return;
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, field.nx, field.ny, 0, gl.RG, gl.FLOAT, field.data);
      this.shown = solved;
      this.requestRender();
    });
  }

  public resize(): void {
    if (!this.gl) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.floor(this.canvas.clientWidth * dpr);
    const height = Math.floor(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.gl.viewport(0, 0, width, height);
    }
  }

  /** The carrier phase advances only while playing, and |E|² does not depend on it at all. */
  private isAnimating(): boolean {
    const state = opticsStore.getState();
    return state.isPlaying && state.renderMode !== 'intensity';
  }

  /** Draw on the next animation frame. Calls made before that frame share the one draw. */
  public requestRender(): void {
    this.dirty = true;
    this.schedule();
  }

  private schedule(): void {
    if (!this.running || this.animFrameId !== null) return;
    this.animFrameId = requestAnimationFrame(this.frame);
  }

  private frame = (time: number): void => {
    this.animFrameId = null;
    // Off-screen and hidden panels neither draw nor request solves; scrolling back reschedules them.
    if (!this.visible) return;
    const animating = this.isAnimating();
    if (animating || this.dirty) {
      this.dirty = false;
      this.render(time);
    }
    if (animating) this.schedule();
  };

  public start(): void {
    if (this.running) return;
    this.running = true;
    this.unsubscribe = opticsStore.subscribe(() => this.requestRender());
    if (typeof IntersectionObserver !== 'undefined') {
      // A margin starts the solve shortly before a panel scrolls into view.
      this.intersection = new IntersectionObserver((entries) => {
        const visible = entries[entries.length - 1].isIntersecting;
        if (visible === this.visible) return;
        this.visible = visible;
        if (visible) this.requestRender();
      }, { rootMargin: '200px' });
      this.intersection.observe(this.canvas);
    }
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.requestRender());
      this.resizeObserver.observe(this.canvas);
    }
    this.requestRender();
  }

  public stop(): void {
    this.running = false;
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.intersection?.disconnect();
    this.intersection = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
  }

  public render(timestamp?: number): void {
    const gl = this.gl;
    if (!gl || !this.program || !this.vao) return;
    if (this.canvas.clientWidth === 0 || this.canvas.clientHeight === 0) return;
    const state = opticsStore.getState();
    if (state.isPlaying && timestamp !== undefined) this.currentTime = (timestamp - this.startTime) * 0.001;
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (width !== this.lastWidth || height !== this.lastHeight) {
      // The first size, and any size with no picture to stretch yet, solves immediately.
      if (this.lastWidth !== 0 && this.shown) {
        this.settleUntil = performance.now() + 120;
        setTimeout(() => this.requestRender(), 130);
      }
      this.lastWidth = width;
      this.lastHeight = height;
    }
    this.resize();
    if (performance.now() >= this.settleUntil) this.syncField(state);

    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    const u = this.uniformLocations;
    gl.uniform1i(u.uField, 0);
    gl.uniform1f(u.uTime, this.currentTime);
    gl.uniform2f(u.uResolution, this.canvas.width, this.canvas.height);
    gl.uniform1i(u.uRenderMode, state.renderMode === 'intensity' ? 1 : state.renderMode === 'phase' ? 2 : 0);
    gl.uniform1i(u.uLogIntensity, state.intensityScale === 'log' ? 1 : 0);
    gl.uniform1f(u.uIntensityMax, state.intensityMax ?? 1);
    this.setUniforms(gl, state);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  public destroy(): void {
    this.stop();
    if (this.gl) {
      this.gl.deleteTexture(this.texture);
      this.gl.deleteProgram(this.program);
    }
  }
}
