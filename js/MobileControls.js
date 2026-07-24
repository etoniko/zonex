/**
 * Мобильное управление (как slither):
 * - свободный джойстик под пальцем → aim от центра экрана
 * - pinch двумя пальцами = зум
 */

import { isMobileLayout, isTV } from './platform.js';

export class MobileControls {
  /**
   * @param {{
   *   mouse: { x: number, y: number },
   *   getViewSpan: () => number,
   *   setViewSpan: (v: number) => void,
   *   viewMin: number,
   *   viewMax: number,
   *   shouldShow: () => boolean,
   * }} api
   */
  constructor(api) {
    this.api = api;
    this.root = document.getElementById('mobile-controls');
    this.stick = document.getElementById('mobile-stick');
    this.stickKnob = document.getElementById('mobile-stick-knob');
    this.cursor = document.getElementById('mobile-cursor');

    this.stickTouchId = null;
    this.radius = 48;
    this.stickSize = 112;
    this.aimPixels = 110;
    this.originX = 0;
    this.originY = 0;
    this._nx = 0;
    this._ny = 0;
    this._active = false;

    this.pinchTouchIds = null;
    this.pinchStartDist = 0;
    this.pinchStartZoom = 1;

    if (!this.root) return;

    this.onTouchStart = this.onTouchStart.bind(this);
    this.onTouchMove = this.onTouchMove.bind(this);
    this.onTouchEnd = this.onTouchEnd.bind(this);

    addEventListener('touchstart', this.onTouchStart, { passive: false, capture: true });
    addEventListener('touchmove', this.onTouchMove, { passive: false, capture: true });
    addEventListener('touchend', this.onTouchEnd, { passive: false, capture: true });
    addEventListener('touchcancel', this.onTouchEnd, { passive: false, capture: true });

    this.hideStick();
    this.hide();
  }

  layoutOk() {
    if (isTV() || document.body.classList.contains('platform-tv')) return false;
    return isMobileLayout();
  }

  syncVisibility() {
    if (this.layoutOk() && this.api.shouldShow()) this.show();
    else this.hide();
  }

  show() {
    if (!this.root || this._active) return;
    this._active = true;
    this.root.hidden = false;
    document.body.classList.add('mobile-play');
    this.applyAim();
    this.updateCursor();
  }

  hide() {
    if (!this.root) return;
    this._active = false;
    this.root.hidden = true;
    document.body.classList.remove('mobile-play');
    this.stickTouchId = null;
    this.pinchTouchIds = null;
    this.hideStick();
  }

  get active() {
    return this._active;
  }

  isUiTarget(target) {
    if (!target || !target.closest) return false;
    return !!target.closest(
      '#overlay, #dead, #settings-btn, #settings-panel, #chat-compose, #hud-chat, #minimap, #side-stack, #board, #board-show, #chat-show, #chat-write, #menu-rating, input, textarea, button, .color-cell'
    );
  }

  onTouchStart(e) {
    if (!this._active) return;

    if (e.touches.length >= 2) {
      e.preventDefault();
      this.beginPinch(e.touches[0], e.touches[1]);
      if (this.stickTouchId != null) {
        this.stickTouchId = null;
        this.hideStick();
      }
      return;
    }

    const t = e.changedTouches[0];
    if (!t) return;
    if (this.isUiTarget(e.target)) return;
    if (this.stickTouchId != null || this.pinchTouchIds) return;

    e.preventDefault();
    this.stickTouchId = t.identifier;
    this.showStickAt(t.clientX, t.clientY);
    this.moveStick(t.clientX, t.clientY);
  }

  onTouchMove(e) {
    if (!this._active) return;

    if (this.pinchTouchIds && e.touches.length >= 2) {
      e.preventDefault();
      const a = this.findTouch(e.touches, this.pinchTouchIds[0]);
      const b = this.findTouch(e.touches, this.pinchTouchIds[1]);
      if (a && b) this.updatePinch(a, b);
      return;
    }

    if (this.stickTouchId == null) return;
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === this.stickTouchId) {
        this.moveStick(t.clientX, t.clientY);
        break;
      }
    }
  }

  onTouchEnd(e) {
    if (!this._active) return;

    if (this.pinchTouchIds) {
      const still = [];
      for (const t of e.touches) still.push(t.identifier);
      const [idA, idB] = this.pinchTouchIds;
      if (!still.includes(idA) || !still.includes(idB)) {
        this.pinchTouchIds = null;
      }
      return;
    }

    if (this.stickTouchId == null) return;
    for (const t of e.changedTouches) {
      if (t.identifier === this.stickTouchId) {
        e.preventDefault();
        this.stickTouchId = null;
        this.hideStick();
        this.applyAim();
        this.updateCursor();
        break;
      }
    }
  }

  beginPinch(t0, t1) {
    this.pinchTouchIds = [t0.identifier, t1.identifier];
    this.pinchStartDist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY) || 1;
    this.pinchStartZoom = this.api.getViewSpan();
  }

  updatePinch(t0, t1) {
    const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY) || 1;
    const ratio = this.pinchStartDist / dist;
    let z = this.pinchStartZoom * ratio;
    z = Math.max(this.api.viewMin, Math.min(this.api.viewMax, z));
    this.api.setViewSpan(z);
  }

  findTouch(touchList, id) {
    for (const t of touchList) {
      if (t.identifier === id) return t;
    }
    return null;
  }

  showStickAt(clientX, clientY) {
    if (!this.stick) return;
    const half = this.stickSize / 2;
    const ox = this._nx * this.radius;
    const oy = this._ny * this.radius;
    this.originX = clientX - ox;
    this.originY = clientY - oy;
    this.stick.hidden = false;
    this.stick.style.left = `${this.originX - half}px`;
    this.stick.style.top = `${this.originY - half}px`;
    if (this.stickKnob) {
      this.stickKnob.style.transform = `translate(${ox}px, ${oy}px)`;
    }
  }

  hideStick() {
    if (this.stick) this.stick.hidden = true;
    if (this.stickKnob) {
      this.stickKnob.style.transform = 'translate(0px, 0px)';
    }
  }

  moveStick(clientX, clientY) {
    let dx = clientX - this.originX;
    let dy = clientY - this.originY;
    const len = Math.hypot(dx, dy) || 0;
    const max = this.radius;
    if (len > max) {
      dx = (dx / len) * max;
      dy = (dy / len) * max;
    }
    this._nx = max > 0 ? dx / max : 0;
    this._ny = max > 0 ? dy / max : 0;
    if (this.stickKnob) {
      this.stickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
    }
    this.applyAim();
    this.updateCursor();
  }

  applyAim() {
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    const px = this.aimPixels;
    this.api.mouse.x = cx + this._nx * px;
    this.api.mouse.y = cy + this._ny * px;
  }

  updateCursor() {
    if (!this.cursor || !this._active) return;
    this.cursor.style.left = `${this.api.mouse.x}px`;
    this.cursor.style.top = `${this.api.mouse.y}px`;
  }
}
