// Starts from the user's tap so mobile browsers permit audio. No downloaded sound assets.
export class WheelAudio {
  private context: AudioContext | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  async unlock() {
    try {
      this.context ??= new AudioContext();
      await this.context.resume();
    } catch {
      /* A muted/unsupported browser must never prevent a spin. */
    }
  }
  start(duration = 4300) {
    this.stop();
    this.stopped = false;
    const start = performance.now();
    const click = () => {
      if (this.stopped || !this.context || this.context.state !== 'running') return;
      const elapsed = performance.now() - start;
      if (elapsed >= duration) return;
      const context = this.context,
        now = context.currentTime;
      const oscillator = context.createOscillator(),
        gain = context.createGain();
      oscillator.type = 'triangle';
      oscillator.frequency.setValueAtTime(1250, now);
      oscillator.frequency.exponentialRampToValueAtTime(250, now + 0.025);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.18, now + 0.002);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.035);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.04);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
      };
      const progress = elapsed / duration;
      this.timer = setTimeout(click, 35 + 280 * Math.pow(progress, 3));
    };
    click();
  }
  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
  close() {
    this.stop();
    void this.context?.close().catch(() => {});
    this.context = null;
  }
}
