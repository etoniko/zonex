/**
 * ТВ-пульт (как slither): стрелки = направление, Enter/OK = без буста (нет в Zona).
 */

import { isTV } from './platform.js';

const ARROWS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export class TvControls {
  /**
   * @param {{
   *   mouse: { x: number, y: number },
   *   shouldShow: () => boolean,
   *   isTyping: () => boolean,
   * }} api
   */
  constructor(api) {
    this.api = api;
    this._nx = 0;
    this._ny = -1;
    this._held = new Set();
    this._hint = null;

    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    this._tick = this._tick.bind(this);

    addEventListener('keydown', this.onKeyDown, true);
    addEventListener('keyup', this.onKeyUp, true);
    this._raf = requestAnimationFrame(this._tick);
  }

  enabled() {
    return isTV() || document.body.classList.contains('platform-tv');
  }

  inGameplay() {
    if (!this.enabled()) return false;
    if (this.api.isTyping()) return false;
    return this.api.shouldShow();
  }

  onKeyDown(e) {
    if (!this.enabled()) return;
    if (this.api.isTyping()) return;
    if (!this.inGameplay()) return;

    const { code } = e;
    if (ARROWS.has(code)) {
      e.preventDefault();
      e.stopPropagation();
      this._held.add(code);
      this._recomputeDir();
      this.applyAim();
    }
  }

  onKeyUp(e) {
    if (!this.enabled()) return;
    if (this.api.isTyping()) return;
    const { code } = e;
    if (ARROWS.has(code)) {
      this._held.delete(code);
      this._recomputeDir();
      this.applyAim();
    }
  }

  _recomputeDir() {
    let x = 0;
    let y = 0;
    if (this._held.has('ArrowLeft')) x -= 1;
    if (this._held.has('ArrowRight')) x += 1;
    if (this._held.has('ArrowUp')) y -= 1;
    if (this._held.has('ArrowDown')) y += 1;
    if (x === 0 && y === 0) return;
    const len = Math.hypot(x, y) || 1;
    this._nx = x / len;
    this._ny = y / len;
  }

  applyAim() {
    const cx = innerWidth * 0.5;
    const cy = innerHeight * 0.5;
    const dist = Math.min(innerWidth, innerHeight) * 0.28;
    this.api.mouse.x = cx + this._nx * dist;
    this.api.mouse.y = cy + this._ny * dist;
  }

  _tick() {
    this._raf = requestAnimationFrame(this._tick);
    if (!this.inGameplay()) {
      this.hideHint();
      return;
    }
    this.applyAim();
    this.showHint();
  }

  showHint() {
    if (this._hint) return;
    const el = document.createElement('div');
    el.id = 'tv-hint';
    el.textContent = 'Стрелки — движение';
    document.body.appendChild(el);
    this._hint = el;
  }

  hideHint() {
    if (!this._hint) return;
    this._hint.remove();
    this._hint = null;
  }
}
